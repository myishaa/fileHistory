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
    gem: "No",
    valueCapital: "100000",
    valueRevenue: "0",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        financialSanctionDate: "2025-07-20",
        soNo: "SO-1",
        soDate: "2025-08-01",
        soValueCapital: "100000",
        soValueRevenue: "",
        firm: "Firm",
        firmType: "Type",
        soCancelled: "No",
        stageDelivery: "No",
        stagePayment: "No",
        advancePayment: "No",
        shortclosure: "No",
        dpDate: "2026-05-01",
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
        soNo: "SO-cancelled",
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

  assert.equal(summary.finance1Summary.asOfDate, "2026-10-20");
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

test("FY Paid/Due counts paid cases only from the same due cohort", () => {
  const makeFile = (id, dpDate, paymentDate) => ({
    id,
    year: "2026-27",
    receivedDate: "2026-05-10",
    fileType: "AMC",
    fileTypeGroup: "contract",
    gem: "No",
    valueCapital: "100000",
    valueRevenue: "0",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        id,
        financialSanctionDate: "2026-04-01",
        soNo: id,
        soDate: "2026-04-02",
        soValueCapital: "100000",
        soValueRevenue: "",
        firm: "Firm",
        firmType: "Type",
        stageDelivery: "No",
        advancePayment: "No",
        soCancelled: "No",
        shortclosure: "No",
        dpDate,
        paymentDate,
        actualPaymentCapital: "100000",
      },
    ],
  });
  const dueAndPaid = makeFile("due-and-paid", "2026-05-01", "2026-06-01");
  const paidBeforeCurrentFyDue = makeFile("paid-before-current-fy-due", "2026-03-01", "2026-06-02");

  const summary = buildDashboardSummary({
    files: [dueAndPaid, paidBeforeCurrentFyDue],
    financeFiles: [dueAndPaid, paidBeforeCurrentFyDue],
    divisions: [],
    settings,
    finance1Year: "2026-27",
    finance1AsOfDate: "2026-10-20",
  });

  assert.equal(summary.finance1Summary.activityCounts.regularPaymentsDueInSelectedFy, 1);
  assert.equal(summary.finance1Summary.activityCounts.regularPaymentsPaidInSelectedFy, 1);
  assert.deepEqual(
    summary.finance1Summary.drillFileIds["activity:paymentPaid:regular:dueCohort:selected"],
    ["due-and-paid"],
  );
  assert.deepEqual(
    summary.finance1Summary.drillFileIds["activity:paymentPaid:regular:selected"],
    ["due-and-paid", "paid-before-current-fy-due"],
  );
});

test("FY Snapshot excludes cancelled S.O. advance-payment activity", () => {
  const makeOrder = (id, cancelled) => ({
    id,
    financialSanctionDate: "2026-04-01",
    soNo: id,
    soDate: "2026-04-02",
    soValueCapital: "100000",
    soValueRevenue: "",
    firm: "Firm",
    firmType: "Type",
    stageDelivery: "No",
    advancePayment: "Yes",
    advancePaymentDetail: {
      stageAmountCapital: "100000",
      stageAmountRevenue: "",
      billSentForPaymentDate: "2026-05-01",
      paymentDate: "2026-06-01",
      actualPaymentCapital: "100000",
      actualPaymentRevenue: "",
    },
    soCancelled: cancelled ? "Yes" : "No",
    soCancelledDate: cancelled ? "2026-06-10" : "",
    shortclosure: "No",
  });
  const file = {
    id: "mixed-advance-payment",
    year: "2026-27",
    receivedDate: "2026-05-10",
    fileType: "AMC",
    fileTypeGroup: "contract",
    gem: "No",
    valueCapital: "200000",
    valueRevenue: "0",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [makeOrder("cancelled-advance", true), makeOrder("live-advance", false)],
  };

  const summary = buildDashboardSummary({
    files: [file],
    financeFiles: [file],
    divisions: [],
    settings,
    finance1Year: "2026-27",
    finance1AsOfDate: "2026-10-20",
  });
  const finance = summary.finance1Summary;

  assert.equal(finance.activityCounts.advancePaymentsInSelectedFy, 1);
  assert.equal(finance.paymentsRecordedInSelectedFy.advance.count, 1);
  assert.equal(finance.activityCounts.billsSentInSelectedFy, 1);
  assert.equal(finance.activityCounts.selectedFyBillsPaidInSelectedFy, 1);
  assert.equal(finance.paidTillDate.capital, 100000);
});

test("FY Snapshot File Type Distribution counts files with cancelled S.O.s once", () => {
  const makeOrder = (id, cancelled) => ({
    id,
    financialSanctionDate: "2026-04-01",
    soNo: id,
    soDate: "2026-04-02",
    soValueCapital: "100000",
    soValueRevenue: "",
    firm: "Firm",
    firmType: "Type",
    stageDelivery: "No",
    stagePayment: "No",
    advancePayment: "No",
    soCancelled: cancelled ? "Yes" : "No",
    soCancelledDate: cancelled ? "2026-06-10" : "",
    shortclosure: "No",
  });
  const partialFile = {
    id: "partial-cancelled-file",
    year: "2026-27",
    receivedDate: "2026-05-10",
    fileType: "AMC",
    fileTypeGroup: "contract",
    gem: "No",
    valueCapital: "200000",
    valueRevenue: "0",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [makeOrder("partial-cancelled-so", true), makeOrder("live-so", false)],
  };
  const fullyCancelledFile = {
    ...partialFile,
    id: "fully-cancelled-file",
    supplyOrders: [makeOrder("fully-cancelled-so", true)],
  };

  const summary = buildDashboardSummary({
    files: [partialFile, fullyCancelledFile],
    financeFiles: [partialFile, fullyCancelledFile],
    divisions: [],
    settings,
    finance1Year: "2026-27",
    finance1AsOfDate: "2026-10-20",
  });
  const finance = summary.finance1Summary;
  const row = finance.fileTypeDistribution.find((item) => item.fileType === "AMC");

  assert.ok(row);
  assert.equal(row.files, 1);
  assert.equal(row.cancelled, 2);
  assert.deepEqual(finance.drillFileIds["fileType:amc:liveCancelled"].sort(), [
    "fully-cancelled-file",
    "partial-cancelled-file",
  ]);
  assert.equal(row.capital, 200000);
  assert.equal(row.revenue, 0);
});
