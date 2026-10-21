import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemandProcessingRows,
  builtInDemandProcessingPresets,
  demandProcessingDateFields,
  getDemandProcessingFieldGroups,
} from "../src/lib/demand-processing-analysis.ts";

test("actual and received completion dates are separate selectable S.O. fields", () => {
  const actual = demandProcessingDateFields.find((field) => field.id === "order.actualJobCompletionDate");
  const received = demandProcessingDateFields.find((field) => field.id === "order.jobCompletionDate");
  const deliveryGroup = getDemandProcessingFieldGroups().find((group) => group.title === "Delivery / IR");

  assert.equal(actual?.label, "Actual Job Completion Date");
  assert.equal(received?.label, "Job Completion Received Date");
  assert.ok(deliveryGroup?.fields.some((field) => field.id === actual?.id));
});

test("S.O. analysis reads its actual completion date and does not fall back to received date", () => {
  const files = [{
    id: "order-completion-dates",
    fileNo: "QA/DP/001",
    supplyOrders: [
      {
        soNo: "SO-1",
        soDate: "2026-06-01",
        actualJobCompletionDate: "2026-07-10",
        jobCompletionDate: "2026-07-15",
      },
      {
        soNo: "SO-2",
        soDate: "2026-06-02",
        actualJobCompletionDate: "",
        jobCompletionDate: "2026-07-20",
      },
    ],
  }];

  const rows = buildDemandProcessingRows(
    files,
    "order.actualJobCompletionDate",
    "order.jobCompletionDate",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderRef, "SO-1");
  assert.equal(rows[0].fromDate, "2026-07-10");
  assert.equal(rows[0].toDate, "2026-07-15");
});

test("stage analysis reads matching stage actual and received dates", () => {
  const files = [{
    id: "stage-completion-dates",
    fileNo: "QA/DP/002",
    supplyOrders: [{
      soNo: "SO-STAGE",
      soDate: "2026-06-01",
      stageDeliveries: [
        {
          actualJobCompletionDate: "2026-07-10",
          jobCompletionDate: "2026-07-12",
        },
        {
          actualJobCompletionDate: "2026-08-01",
          jobCompletionDate: "2026-08-04",
        },
      ],
    }],
  }];

  const rows = buildDemandProcessingRows(
    files,
    "stage.actualJobCompletionDate",
    "stage.jobCompletionDate",
  );

  assert.deepEqual(rows.map((row) => [row.stageIndex, row.fromDate, row.toDate]), [
    [0, "2026-07-10", "2026-07-12"],
    [1, "2026-08-01", "2026-08-04"],
  ]);
  assert.ok(rows.every((row) => row.basis === "Stage"));
});

test("existing received-date preset remains based on the received date", () => {
  const preset = builtInDemandProcessingPresets.find((item) => item.id === "builtin-payment-job-submission");
  const rows = buildDemandProcessingRows(
    [{
      id: "received-date-still-works",
      fileNo: "QA/DP/003",
      supplyOrders: [{
        soNo: "SO-RECEIVED",
        soDate: "2026-06-01",
        actualJobCompletionDate: "2026-07-10",
        jobCompletionDate: "2026-07-15",
        billSentForPaymentDate: "2026-07-20",
      }],
    }],
    "order.jobCompletionDate",
    "order.billSentForPaymentDate",
  );

  assert.equal(preset?.fromFieldId, "order.jobCompletionDate");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromDate, "2026-07-15");
});
