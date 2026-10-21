import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";

const settings = {
  selectedYear: "__all_active_files__",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: ["AMC"],
  firmTypes: [],
  milestones: ["Payment"],
  bgReturnOffsetDays: 60,
};

test("FY payment summary includes only files initiated within the selected FY", () => {
  const priorYearFile = {
    id: "prior-fy-payment",
    year: "2025-26",
    receivedDate: "2025-07-10",
    fileType: "AMC",
    fileTypeGroup: "contract",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        soDate: "2025-08-01",
        soCancelled: "No",
        stageDelivery: "No",
        stagePayment: "No",
        advancePayment: "No",
        shortclosure: "No",
        paymentDate: "2026-06-20",
        actualPaymentCapital: "750000",
        actualPaymentRevenue: "0",
      },
    ],
  };
  const cancelledFile = {
    ...priorYearFile,
    id: "cancelled-prior-fy-payment",
    supplyOrders: [
      {
        ...priorYearFile.supplyOrders[0],
        soCancelled: "Yes",
      },
    ],
  };
  const currentYearFile = {
    ...priorYearFile,
    id: "current-fy-payment",
    year: "2026-27",
    receivedDate: "2026-05-10",
    supplyOrders: [
      {
        ...priorYearFile.supplyOrders[0],
        actualPaymentCapital: "250000",
      },
    ],
  };

  const summary = buildDashboardSummary({
    files: [priorYearFile, cancelledFile, currentYearFile],
    financeFiles: [priorYearFile, cancelledFile, currentYearFile],
    divisions: [],
    settings,
    finance1Year: "2026-27",
    finance1AsOfDate: "2026-10-20",
  });
  const payments = summary.finance1Summary.paymentsRecordedInSelectedFy;

  assert.equal(summary.finance1Summary.fileGroup.count, 1);
  assert.equal(payments.regular.count, 1);
  assert.equal(payments.regular.capital, 250000);
  assert.equal(payments.total.count, 1);
  assert.deepEqual(summary.finance1Summary.drillFileIds["activity:paymentPaid:regular:selected"], [
    "current-fy-payment",
  ]);
  assert.deepEqual(summary.finance1Summary.drillFileIds["activity:paymentPaid:all:selected"], [
    "current-fy-payment",
  ]);
});
