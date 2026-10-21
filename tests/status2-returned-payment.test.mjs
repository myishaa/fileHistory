import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";

const settings = {
  selectedYear: "All Files",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: ["AMC"],
  firmTypes: [],
  milestones: ["Payment"],
  bgReturnOffsetDays: 60,
};

function summaryFor(order) {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "status2-returned-payment-test",
        fileType: "AMC",
        fileTypeGroup: "contract",
        ir: "No",
        demandCancelled: "No",
        completedMilestones: [],
        supplyOrders: [
          {
            soDate: "2026-01-01",
            dpDate: "2026-08-31",
            soCancelled: "No",
            shortclosure: "No",
            noFurtherAction: "No",
            billPreparationDate: "2026-09-01",
            billSentForPaymentDate: "2026-09-02",
            paymentDate: "",
            ...order,
          },
        ],
      },
    ],
    divisions: [],
    settings,
  });
  return summary.statusFlow.find((row) => row.key === "payment");
}

test("Status payment counters separate returned bills from normal payment stages", () => {
  const returnHistory = [{ returnedDate: "2026-09-10", reason: "Correction needed" }];
  const bucketCases = [
    {
      order: {
        billPreparationDate: "",
        billSentForPaymentDate: "",
        billReturnCycles: returnHistory,
      },
      due: 0,
      inProcess: 0,
      submitted: 0,
      returnPending: 1,
      resubmittedUnpaid: 0,
    },
    {
      order: {
        billPreparationDate: "2026-09-08",
        billSentForPaymentDate: "",
        billReturnCycles: [
          { returnedDate: "2026-09-10", resubmittedDate: "2026-09-12" },
        ],
      },
      due: 0,
      inProcess: 0,
      submitted: 0,
      returnPending: 0,
      resubmittedUnpaid: 1,
    },
    {
      order: {
        billSentForPaymentDate: "2026-09-02",
        billReturnCycles: returnHistory,
      },
      due: 0,
      inProcess: 0,
      submitted: 0,
      returnPending: 1,
      resubmittedUnpaid: 0,
    },
  ];

  for (const { order, due, inProcess, submitted, returnPending, resubmittedUnpaid } of bucketCases) {
    const payment = summaryFor(order);
    assert.equal(payment.pending, 1);
    assert.equal(payment.paymentDue, due);
    assert.equal(payment.paymentInProcess, inProcess);
    assert.equal(payment.paymentSubmitted, submitted);
    assert.equal(payment.returnedBillsPending, returnPending);
    assert.equal(payment.returnedBillsResubmitted, resubmittedUnpaid);
    assert.equal(due + inProcess + submitted + returnPending + resubmittedUnpaid, 1);
    assert.equal(
      due +
        inProcess +
        submitted +
        returnPending +
        resubmittedUnpaid +
        payment.advancePending +
        payment.supplementaryPending,
      payment.allPaymentPending,
    );
  }

  const nfa = summaryFor({ noFurtherAction: "Yes" });
  assert.equal(nfa.pending, 0);

  const cancelled = summaryFor({ soCancelled: "Yes" });
  assert.equal(cancelled.pending, 0);

  const paid = summaryFor({ paymentDate: "2026-09-20" });
  assert.equal(paid.pending, 0);
});

test("Supplementary pending is split into three exclusive bill buckets", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "supplementary-pending-breakdown-test",
        fileType: "AMC",
        fileTypeGroup: "contract",
        ir: "No",
        demandCancelled: "No",
        completedMilestones: [],
        supplyOrders: [
          {
            soDate: "2026-01-01",
            soCancelled: "No",
            noFurtherAction: "No",
            supplementaryBills: [
              {
                billNo: "NORMAL",
                billSentForPaymentDate: "2026-09-01",
                paymentDate: "",
              },
              {
                billNo: "RETURNED",
                billSentForPaymentDate: "2026-09-02",
                paymentDate: "",
                billReturnCycles: [{ returnedDate: "2026-09-03", reason: "Correction" }],
              },
              {
                billNo: "RESUBMITTED",
                billSentForPaymentDate: "2026-09-04",
                paymentDate: "",
                billReturnCycles: [
                  { returnedDate: "2026-09-05", resubmittedDate: "2026-09-06" },
                ],
              },
            ],
          },
        ],
      },
    ],
    divisions: [],
    settings,
  });
  const payment = summary.statusFlow.find((row) => row.key === "payment");

  assert.equal(payment.supplementaryPending, 3);
  assert.equal(payment.allPaymentPending, 3);
  assert.equal(payment.supplementaryNormalPending, 1);
  assert.equal(payment.supplementaryReturnedPending, 1);
  assert.equal(payment.supplementaryResubmittedPending, 1);
  assert.equal(
    payment.supplementaryNormalPending +
      payment.supplementaryReturnedPending +
      payment.supplementaryResubmittedPending,
    payment.supplementaryPending,
  );
});
