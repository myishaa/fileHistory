import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

function file(id, supplementaryBill) {
  return {
    id,
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    ir: "Yes",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        soNo: `${id}-SO`,
        soCancelled: "No",
        noFurtherAction: "No",
        supplementaryBills: [supplementaryBill],
      },
    ],
  };
}

function returnedPaidRows(files) {
  return buildReportsSummary({
    files,
    division: "all",
    delayDays: 30,
    delayMilestone: "all",
  }).supplementaryReturnedBillPaidRows;
}

test("supplementary bill with payment but open latest return is not reported as returned-and-paid", () => {
  const rows = returnedPaidRows([
    file("supplementary-open-return", {
      billNo: "SUP-OPEN",
      billAmountCapital: "1000",
      paymentDate: "2026-09-15",
      actualPaymentCapital: "1000",
      billReturnCycles: [{ returnedDate: "2026-09-01", resubmittedDate: "" }],
    }),
  ]);

  assert.deepEqual(rows, []);
});

test("supplementary bill with a resubmitted latest return and payment is reported", () => {
  const rows = returnedPaidRows([
    file("supplementary-resubmitted-paid", {
      billNo: "SUP-PAID",
      billAmountCapital: "1000",
      paymentDate: "2026-09-15",
      actualPaymentCapital: "950",
      billReturnCycles: [{ returnedDate: "2026-09-01", resubmittedDate: "2026-09-05" }],
    }),
  ]);

  assert.deepEqual(rows, [
    {
      monthKey: "2026-09",
      month: "Sep-2026",
      capital: 950,
      revenue: 0,
      total: 950,
    },
  ]);
});
