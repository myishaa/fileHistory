import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

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

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function file(id, order, fields = {}) {
  return {
    id,
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    ir: "Yes",
    demandCancelled: "No",
    completedMilestones: [],
    receivedDate: daysAgo(150),
    supplyOrders: [
      {
        soDate: daysAgo(130),
        soCancelled: "No",
        noFurtherAction: "No",
        ...order,
      },
    ],
    ...fields,
  };
}

function paymentPreSubmissionRanking(files) {
  return buildDashboardSummary({ files, divisions: [], settings }).analytics.milestoneClearingRanking.find(
    (row) => row.name === "Payment cycle (ASL)",
  );
}

function paymentPostSubmissionRanking(files) {
  return buildDashboardSummary({ files, divisions: [], settings }).analytics.milestoneClearingRanking.find(
    (row) => row.name === "Payment cycle (PCDA)",
  );
}

function cumulativePaymentRanking(files) {
  return buildDashboardSummary({ files, divisions: [], settings }).analytics.milestoneClearingRanking.find(
    (row) => row.name === "Payment (ASL + PCDA)",
  );
}

test("pre-submission Delay Status uses IR Receipt or Job Completion Received Date and never D.P.", () => {
  const files = [
    file("group-a-ir-yes", {
      irReceiptDate: daysAgo(50),
      jobCompletionDate: daysAgo(2),
    }),
    file(
      "group-a-ir-no",
      { irReceiptDate: daysAgo(2), jobCompletionDate: daysAgo(45) },
      { ir: "No" },
    ),
    file(
      "group-b",
      { irReceiptDate: daysAgo(2), jobCompletionDate: daysAgo(40) },
      { fileType: "AMC", fileTypeGroup: "contract" },
    ),
    file(
      "missing-job-completion",
      { dpDate: daysAgo(100), revisedDp: daysAgo(90) },
      { fileType: "AMC", fileTypeGroup: "contract" },
    ),
    file("excluded", {
      irReceiptDate: daysAgo(80),
      includeInPaymentTiming: false,
    }),
    file("already-submitted", {
      irReceiptDate: daysAgo(80),
      billSentForPaymentDate: daysAgo(70),
    }),
    file("nfa", {
      irReceiptDate: daysAgo(80),
      noFurtherAction: "Yes",
    }),
  ];

  const summary = buildReportsSummary({
    files,
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPreSubmission",
  });
  assert.deepEqual(
    summary.delayRows.map((row) => row.fileRef || row.fileId).sort(),
    ["group-a-ir-no", "group-a-ir-yes", "group-b"],
  );
  assert.equal(
    summary.delayRows.find((row) => row.fileId === "group-a-ir-yes").stageStartDate,
    files[0].supplyOrders[0].irReceiptDate,
  );
  assert.equal(
    summary.delayRows.find((row) => row.fileId === "group-b").stageStartDate,
    files[2].supplyOrders[0].jobCompletionDate,
  );
});

test("stagewise payments use each stage; common payment waits for the latest applicable stage date", () => {
  const stagewise = file("stagewise", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    stageDeliveries: [
      { irReceiptDate: daysAgo(60), includeInPaymentTiming: true },
      { irReceiptDate: daysAgo(40), includeInPaymentTiming: false },
    ],
  });
  const common = file("common", {
    stageDelivery: "Yes",
    stagePayment: "No",
    irReceiptDate: daysAgo(100),
    stageDeliveries: [
      { irReceiptDate: daysAgo(60) },
      { irReceiptDate: daysAgo(40) },
    ],
  });
  const summary = buildReportsSummary({
    files: [stagewise, common],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPreSubmission",
  });
  assert.deepEqual(summary.delayRows.map((row) => row.fileId).sort(), ["common", "stagewise"]);
  assert.equal(
    summary.delayRows.find((row) => row.fileId === "common").stageStartDate,
    common.supplyOrders[0].stageDeliveries[1].irReceiptDate,
  );
  assert.equal(
    summary.delayRows.find((row) => row.fileId === "stagewise").stageStartDate,
    stagewise.supplyOrders[0].stageDeliveries[0].irReceiptDate,
  );
  assert.equal(summary.delaySummary.byMilestone[0].count, 2);
  assert.equal(summary.delaySummary.byMilestone[0].fileCount, 2);
});

test("submitted stagewise payments are not pending when parent S.O. dates are blank", () => {
  const alreadySubmitted = file("stagewise-already-submitted", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    billSentForPaymentDate: "",
    paymentDate: "",
    stageDeliveries: [
      {
        irReceiptDate: daysAgo(70),
        billSentForPaymentDate: daysAgo(60),
        paymentDate: daysAgo(45),
      },
      {
        irReceiptDate: daysAgo(55),
        billSentForPaymentDate: daysAgo(50),
        billReturnCycles: [{ returnedDate: daysAgo(40) }],
      },
    ],
  });

  const summary = buildReportsSummary({
    files: [alreadySubmitted],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPreSubmission",
  });

  assert.equal(summary.delayRows.length, 0);
});

test("ranking stops at first submission for returned bills and honors payment-level exclusion", () => {
  const returned = file("returned", {
    irReceiptDate: daysAgo(100),
    billSentForPaymentDate: daysAgo(90),
    billReturnCycles: [{ returnedDate: daysAgo(30), resubmittedDate: daysAgo(10) }],
  });
  const excluded = file("excluded-ranking", {
    irReceiptDate: daysAgo(100),
    billSentForPaymentDate: daysAgo(70),
    includeInPaymentTiming: false,
  });
  const supplementaryOnly = file("supplementary-only", {
    irReceiptDate: daysAgo(100),
    supplementaryBills: [{ billSentForPaymentDate: daysAgo(70) }],
  });

  const row = paymentPreSubmissionRanking([returned, excluded, supplementaryOnly]);
  assert.ok(row);
  assert.equal(row.sampleSize, 1);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 10);
  assert.equal(row.fileIds, "returned");
});

test("ranking counts stagewise payments separately and uses the latest stage trigger for common payment", () => {
  const stagewise = file("rank-stagewise", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    stageDeliveries: [
      { irReceiptDate: daysAgo(100), billSentForPaymentDate: daysAgo(80) },
      { irReceiptDate: daysAgo(60), billSentForPaymentDate: daysAgo(40) },
    ],
  });
  const common = file("rank-common", {
    stageDelivery: "Yes",
    stagePayment: "No",
    billSentForPaymentDate: daysAgo(30),
    stageDeliveries: [
      { irReceiptDate: daysAgo(100) },
      { irReceiptDate: daysAgo(50) },
    ],
  });

  const row = paymentPreSubmissionRanking([stagewise, common]);
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 2);
  assert.equal(row.fileIds, "rank-stagewise,rank-common");
});

test("post-submission Delay Status requires a submitted unpaid case with no return history", () => {
  const summary = buildReportsSummary({
    files: [
      file("authority-pending", {
        billSentForPaymentDate: daysAgo(50),
      }),
      file("authority-returned", {
        billSentForPaymentDate: daysAgo(70),
        billReturnCycles: [{ returnedDate: daysAgo(40) }],
      }),
      file("authority-paid", {
        billSentForPaymentDate: daysAgo(70),
        paymentDate: daysAgo(45),
      }),
      file("authority-excluded", {
        billSentForPaymentDate: daysAgo(70),
        includeInPaymentTiming: false,
      }),
      file("authority-not-submitted", {
        irReceiptDate: daysAgo(80),
      }),
    ],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPostSubmission",
  });

  assert.deepEqual(summary.delayRows.map((row) => row.fileId), ["authority-pending"]);
  assert.equal(summary.delayRows[0].stageStartDate, daysAgo(50));
  assert.equal(summary.delaySummary.byMilestone[0].count, 1);
  assert.equal(summary.delaySummary.byMilestone[0].fileCount, 1);
});

test("post-submission timing counts each stagewise payment and one common staged payment", () => {
  const stagewise = file("authority-stagewise", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    billSentForPaymentDate: "",
    paymentDate: "",
    stageDeliveries: [
      { billSentForPaymentDate: daysAgo(60) },
      { billSentForPaymentDate: daysAgo(40), paymentDate: daysAgo(20) },
    ],
  });
  const common = file("authority-common", {
    stageDelivery: "Yes",
    stagePayment: "No",
    billSentForPaymentDate: daysAgo(45),
    paymentDate: "",
    stageDeliveries: [{}, {}],
  });

  const summary = buildReportsSummary({
    files: [stagewise, common],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPostSubmission",
  });
  assert.deepEqual(summary.delayRows.map((row) => row.fileId).sort(), ["authority-common", "authority-stagewise"]);
  assert.equal(summary.delaySummary.byMilestone[0].count, 2);
  assert.equal(summary.delaySummary.byMilestone[0].fileCount, 2);
});

test("post-submission Delay Status includes advance and supplementary cases with their own dates", () => {
  const summary = buildReportsSummary({
    files: [
      file("authority-advance", {
        advancePayment: "Yes",
        advancePaymentDetail: { billSentForPaymentDate: daysAgo(50) },
      }),
      file("authority-supplementary", {
        supplementaryBills: [{ billSentForPaymentDate: daysAgo(55) }],
      }),
      file("authority-advance-returned", {
        advancePayment: "Yes",
        advancePaymentDetail: {
          billSentForPaymentDate: daysAgo(60),
          billReturnCycles: [{ returnedDate: daysAgo(30) }],
        },
      }),
      file("authority-supplementary-excluded", {
        supplementaryBills: [
          { billSentForPaymentDate: daysAgo(60), includeInPaymentTiming: false },
        ],
      }),
    ],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentPostSubmission",
  });

  assert.deepEqual(
    summary.delayRows.map((row) => row.fileId).sort(),
    ["authority-advance", "authority-supplementary"],
  );
  assert.equal(summary.delaySummary.byMilestone[0].count, 2);
  assert.equal(summary.delaySummary.byMilestone[0].fileCount, 2);
});

test("Payment cycle (PCDA) ranking excludes returns and excluded cases but includes advances and supplementary bills", () => {
  const paid = file("authority-rank-paid", {
    billSentForPaymentDate: daysAgo(45),
    paymentDate: daysAgo(15),
  });
  const returned = file("authority-rank-returned", {
    billSentForPaymentDate: daysAgo(60),
    paymentDate: daysAgo(20),
    billReturnCycles: [{ returnedDate: daysAgo(40), resubmittedDate: daysAgo(30) }],
  });
  const excluded = file("authority-rank-excluded", {
    billSentForPaymentDate: daysAgo(50),
    paymentDate: daysAgo(20),
    includeInPaymentTiming: false,
  });
  const supplementary = file("authority-rank-supplementary", {
    supplementaryBills: [{ billSentForPaymentDate: daysAgo(50), paymentDate: daysAgo(20) }],
  });
  const advance = file("authority-rank-advance", {
    advancePayment: "Yes",
    advancePaymentDetail: { billSentForPaymentDate: daysAgo(50), paymentDate: daysAgo(20) },
  });

  const row = paymentPostSubmissionRanking([paid, returned, excluded, supplementary, advance]);
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 3);
  assert.deepEqual(
    row.fileIds.split(",").sort(),
    ["authority-rank-advance", "authority-rank-paid", "authority-rank-supplementary"],
  );
  assert.equal(row.averageDays, 30);
});

test("Payment cycle (PCDA) ranking counts each stagewise payment but one common payment", () => {
  const stagewise = file("authority-rank-stagewise", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    billSentForPaymentDate: "",
    paymentDate: "",
    stageDeliveries: [
      { billSentForPaymentDate: daysAgo(40), paymentDate: daysAgo(30) },
      { billSentForPaymentDate: daysAgo(25), paymentDate: daysAgo(15) },
    ],
  });
  const common = file("authority-rank-common", {
    stageDelivery: "Yes",
    stagePayment: "No",
    billSentForPaymentDate: daysAgo(35),
    paymentDate: daysAgo(20),
    stageDeliveries: [{}, {}],
  });

  const row = paymentPostSubmissionRanking([stagewise, common]);
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 2);
  assert.deepEqual(row.fileIds.split(",").sort(), ["authority-rank-common", "authority-rank-stagewise"]);
});

test("cumulative Delay Status uses trigger-to-today and caps returned bills at first submission", () => {
  const summary = buildReportsSummary({
    files: [
      file("cumulative-unsubmitted", { irReceiptDate: daysAgo(80) }),
      file("cumulative-submitted", {
        irReceiptDate: daysAgo(100),
        billSentForPaymentDate: daysAgo(60),
      }),
      file("cumulative-returned-long", {
        irReceiptDate: daysAgo(120),
        billSentForPaymentDate: daysAgo(70),
        billReturnCycles: [{ returnedDate: daysAgo(20), resubmittedDate: daysAgo(5) }],
      }),
      file("cumulative-returned-short", {
        irReceiptDate: daysAgo(120),
        billSentForPaymentDate: daysAgo(100),
        billReturnCycles: [{ returnedDate: daysAgo(5) }],
      }),
      file("cumulative-paid", {
        irReceiptDate: daysAgo(120),
        billSentForPaymentDate: daysAgo(100),
        paymentDate: daysAgo(40),
      }),
    ],
    division: "all",
    delayDays: 30,
    delayMilestone: "paymentCumulative",
  });

  assert.deepEqual(
    summary.delayRows.map((row) => row.fileId).sort(),
    ["cumulative-returned-long", "cumulative-submitted", "cumulative-unsubmitted"],
  );
  assert.equal(summary.delaySummary.byMilestone[0].count, 3);
  assert.equal(summary.delaySummary.byMilestone[0].fileCount, 3);
});

test("cumulative ranking includes paid cases only and stops returned bills at first submission", () => {
  const regularPaid = file("cumulative-rank-paid", {
    irReceiptDate: daysAgo(100),
    billSentForPaymentDate: daysAgo(70),
    paymentDate: daysAgo(20),
  });
  const regularReturned = file("cumulative-rank-returned", {
    irReceiptDate: daysAgo(110),
    billSentForPaymentDate: daysAgo(65),
    paymentDate: daysAgo(10),
    billReturnCycles: [{ returnedDate: daysAgo(50), resubmittedDate: daysAgo(30) }],
  });
  const excluded = file("cumulative-rank-excluded", {
    irReceiptDate: daysAgo(100),
    includeInPaymentTiming: false,
  });
  const advance = file("cumulative-rank-advance", {
    advancePayment: "Yes",
    advancePaymentDetail: {
      billSentForPaymentDate: daysAgo(40),
      paymentDate: daysAgo(15),
    },
  });
  const supplementary = file("cumulative-rank-supplementary", {
    supplementaryBills: [{ billSentForPaymentDate: daysAgo(35) }],
  });

  const row = cumulativePaymentRanking([
    regularPaid,
    regularReturned,
    excluded,
    advance,
    supplementary,
  ]);
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 3);
  assert.deepEqual(row.fileIds.split(",").sort(), [
    "cumulative-rank-advance",
    "cumulative-rank-paid",
    "cumulative-rank-returned",
  ]);
  assert.equal(row.averageDays, 50);
});

test("cumulative ranking counts stagewise payments separately and common staged payment once", () => {
  const stagewise = file("cumulative-rank-stagewise", {
    stageDelivery: "Yes",
    stagePayment: "Yes",
    billSentForPaymentDate: "",
    paymentDate: "",
    stageDeliveries: [
      { irReceiptDate: daysAgo(100), billSentForPaymentDate: daysAgo(60), paymentDate: daysAgo(30) },
      { irReceiptDate: daysAgo(50), billSentForPaymentDate: daysAgo(35), paymentDate: daysAgo(15) },
    ],
  });
  const common = file("cumulative-rank-common", {
    stageDelivery: "Yes",
    stagePayment: "No",
    billSentForPaymentDate: daysAgo(25),
    paymentDate: daysAgo(5),
    stageDeliveries: [{ irReceiptDate: daysAgo(90) }, { irReceiptDate: daysAgo(40) }],
  });

  const row = cumulativePaymentRanking([stagewise, common]);
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 2);
  assert.deepEqual(row.fileIds.split(",").sort(), ["cumulative-rank-common", "cumulative-rank-stagewise"]);
});
