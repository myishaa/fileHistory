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

function shiftDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function paymentCounts(dpDate, billPreparationDate) {
  const file = {
    id: "status2-future-dp-test",
    fileType: "AMC",
    fileTypeGroup: "contract",
    ir: "No",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        soDate: shiftDate(-60),
        dpDate,
        soCancelled: "No",
        shortclosure: "No",
        noFurtherAction: "No",
        billPreparationDate,
        paymentDate: "",
      },
    ],
  };
  const summary = buildDashboardSummary({ files: [file], divisions: [], settings });
  const payment = summary.statusFlow.find((row) => row.key === "payment");
  return {
    due: payment.paymentDue,
    inProcess: payment.paymentInProcess,
    pending: payment.pending,
  };
}

test("Status-2 excludes future D.P. triggers but keeps prepared bills in follow-up", () => {
  assert.deepEqual(paymentCounts(shiftDate(10)), { due: 0, inProcess: 0, pending: 0 });
  assert.deepEqual(paymentCounts(shiftDate(-1)), { due: 1, inProcess: 0, pending: 1 });
  assert.deepEqual(paymentCounts(shiftDate(10), shiftDate(-1)), {
    due: 0,
    inProcess: 1,
    pending: 1,
  });
});
