import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemandProcessingRows,
  filterDemandProcessingRowsByFromDate,
  getDemandProcessingDateFieldValueForRow,
  isUnifiedPaymentField,
} from "../src/lib/demand-processing-analysis.ts";

test("Payment Mode applies only when a Unified Payment field is selected", () => {
  assert.equal(isUnifiedPaymentField("payment.unifiedPaymentDate"), true);
  assert.equal(isUnifiedPaymentField("payment.unifiedSubmissionDate"), true);
  assert.equal(isUnifiedPaymentField("order.paymentDate"), false);
  assert.equal(isUnifiedPaymentField("file.receivedDate"), false);
});

function analysisRow(fileId, fromDate, toDate) {
  return {
    fileId,
    fileRef: fileId,
    division: "",
    orderRef: "",
    basis: "File",
    fromDate,
    toDate,
    gapDays: 0,
    valueCapital: 0,
    valueRevenue: 0,
  };
}

test("DPA Activity range uses the selected From milestone, not received date", () => {
  const rows = [
    ...buildDemandProcessingRows(
      [
        {
          id: "received-outside-from-inside",
          receivedDate: "2025-05-06",
          supplyOrders: [{ financialSanctionDate: "2026-04-08", soDate: "2026-04-15" }],
        },
      ],
      "order.financialSanctionDate",
      "order.soDate",
    ),
    analysisRow("from-outside-to-inside", "2025-05-06", "2026-04-15"),
    analysisRow("from-inside-to-outside", "2026-04-08", "2027-04-10"),
  ];

  const filtered = filterDemandProcessingRowsByFromDate(rows, {
    fromDate: "2026-04-01",
    toDate: "2027-03-31",
  });

  assert.deepEqual(
    filtered.map((row) => row.fileId),
    ["received-outside-from-inside", "from-inside-to-outside"],
  );
});

test("DPA Activity range excludes rows whose From milestone is outside the range", () => {
  const rows = [analysisRow("before-range", "2025-05-06", "2026-04-15")];

  assert.deepEqual(
    filterDemandProcessingRowsByFromDate(rows, {
      fromDate: "2026-04-01",
      toDate: "2027-03-31",
    }),
    [],
  );
});

test("unified payment filters read dates from the matching advance event", () => {
  const file = {
    id: "advance-filter-context",
    fileNo: "QA/DPA/ADVANCE",
    supplyOrders: [
      {
        soNo: "SO-ADVANCE",
        paymentDate: "2026-05-30",
        advancePaymentDetail: {
          billSentForPaymentDate: "2026-05-10",
          paymentDate: "2026-05-20",
        },
      },
    ],
  };
  const [row] = buildDemandProcessingRows(
    [file],
    "payment.unifiedSubmissionDate",
    "payment.unifiedPaymentDate",
  );

  assert.equal(row.basis, "Advance");
  assert.equal(row.unifiedPaymentDate, "2026-05-20");
  assert.equal(
    getDemandProcessingDateFieldValueForRow("payment.unifiedPaymentDate", file, row),
    "2026-05-20",
  );
  assert.equal(
    getDemandProcessingDateFieldValueForRow("advance.paymentDate", file, row),
    "2026-05-20",
  );
});

test("stage date filters read the matching stage, not parent S.O. dates", () => {
  const file = {
    id: "stage-filter-context",
    fileNo: "QA/DPA/STAGE",
    supplyOrders: [
      {
        soNo: "SO-STAGE",
        billSentForPaymentDate: "2026-05-01",
        paymentDate: "2026-05-30",
        stageDeliveries: [
          {
            billSentForPaymentDate: "2026-05-15",
            paymentDate: "2026-05-20",
            billReturnCycles: [{ returnedDate: "2026-05-05", resubmittedDate: "2026-05-15" }],
          },
        ],
      },
    ],
  };
  const rows = buildDemandProcessingRows(
    [file],
    "payment.unifiedSubmissionDate",
    "payment.unifiedPaymentDate",
  );
  const row = rows.find((item) => item.basis === "Stage");

  assert.ok(row);
  assert.equal(row.basis, "Stage");
  assert.equal(row.unifiedSubmissionDate, "2026-05-15");
  assert.equal(row.unifiedPaymentDate, "2026-05-20");
  assert.equal(
    getDemandProcessingDateFieldValueForRow("stage.paymentDate", file, row),
    "2026-05-20",
  );
});

test("supplementary payment filters retain the exact bill event context", () => {
  const file = {
    id: "supplementary-filter-context",
    fileNo: "QA/DPA/SUPP",
    supplyOrders: [
      {
        soNo: "SO-SUPP",
        paymentDate: "2026-05-30",
        supplementaryBills: [
          { billSentForPaymentDate: "2026-05-10", paymentDate: "2026-05-20" },
          { billSentForPaymentDate: "2026-06-01", paymentDate: "2026-06-09" },
        ],
      },
    ],
  };
  const rows = buildDemandProcessingRows(
    [file],
    "payment.unifiedSubmissionDate",
    "payment.unifiedPaymentDate",
  );
  const supplementaryRow = rows.find((row) => row.supplementaryBillIndex === 0);

  assert.ok(supplementaryRow);
  assert.equal(supplementaryRow.paymentObjectKind, "supplementary");
  assert.equal(supplementaryRow.unifiedPaymentDate, "2026-05-20");
  assert.equal(
    getDemandProcessingDateFieldValueForRow("payment.unifiedPaymentDate", file, supplementaryRow),
    "2026-05-20",
  );
});

test("an advance-specific date filter resolves the advance object on a non-unified pair", () => {
  const file = {
    id: "advance-specific-filter-context",
    fileNo: "QA/DPA/ADVANCE-SPECIFIC",
    supplyOrders: [
      {
        soNo: "SO-ADVANCE-SPECIFIC",
        paymentDate: "2026-05-30",
        advancePaymentDetail: {
          billPreparationDate: "2026-05-08",
          paymentDate: "2026-05-20",
        },
      },
    ],
  };
  const [row] = buildDemandProcessingRows(
    [file],
    "advance.billPreparationDate",
    "advance.paymentDate",
  );

  assert.equal(row.basis, "Advance");
  assert.equal(
    getDemandProcessingDateFieldValueForRow("advance.paymentDate", file, row),
    "2026-05-20",
  );
});

test("a parent S.O. payment date does not make a stage payment-date filter pass", () => {
  const file = {
    id: "stage-filter-no-parent-fallback",
    fileNo: "QA/DPA/STAGE-BLANK-PAYMENT",
    supplyOrders: [
      {
        soNo: "SO-STAGE-BLANK",
        paymentDate: "2026-05-20",
        stageDeliveries: [
          {
            actualJobCompletionDate: "2026-05-01",
            billPreparationDate: "2026-05-08",
            paymentDate: "",
          },
        ],
      },
    ],
  };
  const [row] = buildDemandProcessingRows(
    [file],
    "stage.actualJobCompletionDate",
    "stage.billPreparationDate",
  );

  assert.equal(row.basis, "Stage");
  assert.equal(getDemandProcessingDateFieldValueForRow("stage.paymentDate", file, row), undefined);
});
