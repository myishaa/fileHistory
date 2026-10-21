import assert from "node:assert/strict";
import test from "node:test";
import { buildDemandProcessingRows } from "../src/lib/demand-processing-analysis.ts";

test("stage comparisons use recorded stage amounts instead of repeating the S.O. value", () => {
  const rows = buildDemandProcessingRows(
    [{
      id: "stage-values",
      fileNo: "QA/DPA/STAGE-VALUES",
      supplyOrders: [{
        soNo: "SO-STAGE-VALUES",
        soDate: "2026-06-01",
        soValueCapital: "100",
        stageDeliveries: [
          {
            stageAmountCapital: "40",
            actualJobCompletionDate: "2026-07-01",
            jobCompletionDate: "2026-07-02",
          },
          {
            stageAmountCapital: "60",
            actualJobCompletionDate: "2026-08-01",
            jobCompletionDate: "2026-08-02",
          },
        ],
      }],
    }],
    "stage.actualJobCompletionDate",
    "stage.jobCompletionDate",
  );

  assert.deepEqual(rows.map((row) => row.valueCapital), [40, 60]);
  assert.equal(rows.reduce((total, row) => total + row.valueCapital, 0), 100);
});

test("a missing stage amount does not fall back to the parent S.O. amount", () => {
  const rows = buildDemandProcessingRows(
    [{
      id: "stage-missing-value",
      fileNo: "QA/DPA/STAGE-MISSING-VALUE",
      supplyOrders: [{
        soNo: "SO-STAGE-MISSING",
        soDate: "2026-06-01",
        soValueCapital: "100",
        stageDeliveries: [{
          stageAmountCapital: "",
          stageAmountRevenue: "25",
          actualJobCompletionDate: "2026-07-01",
          jobCompletionDate: "2026-07-02",
        }],
      }],
    }],
    "stage.actualJobCompletionDate",
    "stage.jobCompletionDate",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].valueCapital, 0);
  assert.equal(rows[0].valueRevenue, 25);
});

test("unified stage-payment rows use stage amounts and leave missing amounts at zero", () => {
  const rows = buildDemandProcessingRows(
    [{
      id: "unified-stage-values",
      fileNo: "QA/DPA/UNIFIED-STAGE-VALUES",
      supplyOrders: [{
        soNo: "SO-UNIFIED-STAGE",
        soDate: "2026-06-01",
        soValueCapital: "100",
        stageDeliveries: [
          {
            stageAmountCapital: "40",
            billSentForPaymentDate: "2026-07-01",
            paymentDate: "2026-07-10",
          },
          {
            stageAmountCapital: "",
            billSentForPaymentDate: "2026-08-01",
            paymentDate: "2026-08-10",
          },
        ],
      }],
    }],
    "payment.unifiedSubmissionDate",
    "payment.unifiedPaymentDate",
  );
  const stageRows = rows.filter((row) => row.basis === "Stage");

  assert.deepEqual(stageRows.map((row) => row.valueCapital), [40, 0]);
});

test("unified advance and supplementary rows use actual amounts when paid, otherwise planned amounts", () => {
  const paidRows = buildDemandProcessingRows(
    [{
      id: "unified-event-values",
      fileNo: "QA/DPA/UNIFIED-EVENT-VALUES",
      supplyOrders: [{
        soNo: "SO-PAID-ADVANCE",
        soDate: "2026-06-02",
        soValueCapital: "200",
        advancePaymentDetail: {
          stageAmountCapital: "30",
          actualPaymentCapital: "20",
          billSentForPaymentDate: "2026-07-05",
          paymentDate: "2026-07-12",
        },
        supplementaryBills: [{
          billAmountCapital: "15",
          actualPaymentCapital: "12",
          billSentForPaymentDate: "2026-07-05",
          paymentDate: "2026-07-12",
        }],
      }, {
        soNo: "SO-MISSING-ADVANCE",
        soDate: "2026-06-03",
        soValueCapital: "300",
        advancePaymentDetail: {
          billSentForPaymentDate: "2026-07-06",
        },
      }],
    }],
    "payment.unifiedSubmissionDate",
    "payment.unifiedPaymentDate",
  );
  const unpaidRows = buildDemandProcessingRows(
    [{
      id: "unified-event-values-unpaid",
      fileNo: "QA/DPA/UNIFIED-EVENT-VALUES-UNPAID",
      supplyOrders: [{
        soNo: "SO-UNPAID-EVENTS",
        soDate: "2026-06-01",
        soValueCapital: "100",
        advancePaymentDetail: {
          stageAmountCapital: "30",
          billSentForPaymentDate: "2026-07-01",
          billReturnCycles: [{ returnedDate: "2026-07-05", resubmittedDate: "2026-07-06" }],
        },
        supplementaryBills: [
          {
            billAmountCapital: "15",
            billSentForPaymentDate: "2026-07-02",
            billReturnCycles: [{ returnedDate: "2026-07-06", resubmittedDate: "2026-07-07" }],
          },
          {
            billAmountCapital: "",
            billSentForPaymentDate: "2026-07-04",
            billReturnCycles: [{ returnedDate: "2026-07-08", resubmittedDate: "2026-07-09" }],
          },
        ],
      }, {
        soNo: "SO-UNALLOCATED-ADVANCE",
        soDate: "2026-06-02",
        soValueCapital: "200",
        advancePaymentDetail: {
          billSentForPaymentDate: "2026-07-03",
          billReturnCycles: [{ returnedDate: "2026-07-07", resubmittedDate: "2026-07-08" }],
        },
      }],
    }],
    "payment.unifiedSubmissionDate",
    "payment.unifiedReturnDate",
  );
  const paidAdvanceRows = paidRows.filter((row) => row.basis === "Advance");
  const paidSupplementaryRows = paidRows.filter((row) => row.paymentObjectKind === "supplementary");
  const unpaidAdvanceRows = unpaidRows.filter((row) => row.basis === "Advance");
  const unpaidSupplementaryRows = unpaidRows.filter((row) => row.paymentObjectKind === "supplementary");

  assert.deepEqual(paidAdvanceRows.map((row) => row.valueCapital), [20]);
  assert.deepEqual(paidSupplementaryRows.map((row) => row.valueCapital), [12]);
  assert.deepEqual(unpaidAdvanceRows.map((row) => row.valueCapital), [30, 0]);
  assert.deepEqual(unpaidSupplementaryRows.map((row) => row.valueCapital), [15, 0]);
});
