import assert from "node:assert/strict";
import test from "node:test";
import {
  getQuickEntryAdvanceStageIndex,
  getQuickEntryExportDpDate,
  getQuickEntryExportPaidSoFar,
  getQuickEntryExportRowPlan,
  getQuickEntryExportSoAmount,
  getQuickEntryExportSoAmountComponent,
  getQuickEntrySupplementaryStageIndex,
  getQuickEntryBillLifecycleEvents,
  isQuickEntryExportFieldApplicable,
} from "../backend/src/utils/quick-entry-export.ts";

test("bill lifecycle events produce one chronologically ordered row per event", () => {
  assert.deepEqual(getQuickEntryBillLifecycleEvents("2026-05-01", [
    { returnedDate: "2026-05-05", resubmittedDate: "2026-05-08", reason: "Correction" },
    { returnedDate: "2026-05-12", resubmittedDate: "2026-05-15" },
  ], "2026-05-20"), [
    { eventType: "Bill sent", eventDate: "2026-05-01" },
    { eventType: "Returned", eventDate: "2026-05-05", cycleIndex: 0, reason: "Correction", remarks: undefined },
    { eventType: "Resubmitted", eventDate: "2026-05-08", cycleIndex: 0, reason: "Correction", remarks: undefined },
    { eventType: "Returned", eventDate: "2026-05-12", cycleIndex: 1, reason: undefined, remarks: undefined },
    { eventType: "Resubmitted", eventDate: "2026-05-15", cycleIndex: 1, reason: undefined, remarks: undefined },
    { eventType: "Paid", eventDate: "2026-05-20" },
  ]);
});

test("conditional export cells are blank while context fields remain available", () => {
  const context = {
    inspectionApplicable: true,
    biddingApplicable: true,
    file: { ir: "Yes", refloat: "No", tcec: "No", fileType: "Goods & Services" },
    order: { stageDelivery: "No", bgCoverageType: "None", psbApplicable: "No" },
  };

  assert.equal(isQuickEntryExportFieldApplicable("ir", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("refloat", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("psbApplicable", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("irReceiptDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("jobCompletionDate", context), false);
  assert.equal(isQuickEntryExportFieldApplicable("refloatBiddingDate", context), false);
  assert.equal(isQuickEntryExportFieldApplicable("postTcecDate", context), false);
  assert.equal(isQuickEntryExportFieldApplicable("psbBgReceivedDate", context), false);
  assert.equal(isQuickEntryExportFieldApplicable("stagePaymentDate", context), false);
});

test("applicable BG, refloat, and non-inspection completion fields are retained", () => {
  const context = {
    inspectionApplicable: false,
    biddingApplicable: true,
    file: { ir: "No", refloat: "Yes", tcec: "Yes", bg: "Yes" },
    order: {
      bgCoverageType: "PSB and PWB separately",
      psbApplicable: "Yes",
      stageDelivery: "Yes",
      stagePayment: "Yes",
    },
  };

  assert.equal(isQuickEntryExportFieldApplicable("jobCompletionDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("materialReceiptDate", context), false);
  assert.equal(isQuickEntryExportFieldApplicable("refloatBiddingDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("refloatPostTcecDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("psbBgReceivedDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("pwbBgReceivedDate", context), true);
  assert.equal(isQuickEntryExportFieldApplicable("stagePaymentDate", context), true);
});

test("advance details in expanded staged exports belong to Stage 1", () => {
  assert.equal(getQuickEntryAdvanceStageIndex([{}, {}, {}]), 0);
  assert.equal(getQuickEntryAdvanceStageIndex([]), undefined);
});

test("staged S.O. export D.P. uses the last stage revised D.P. when available", () => {
  assert.equal(
    getQuickEntryExportDpDate({
      dpDate: "",
      stageDelivery: "Yes",
      stageDeliveryCount: "3",
      stageDeliveries: [
        { dpDate: "2026-07-10" },
        { dpDate: "2026-07-20", revisedDp: "2026-07-25" },
        { dpDate: "2026-08-01", revisedDp: "2026-08-10" },
      ],
    }),
    "2026-08-10",
  );
});

test("staged S.O. export D.P. falls back to the last stage original D.P.", () => {
  assert.equal(
    getQuickEntryExportDpDate({
      dpDate: "",
      stageDelivery: "Yes",
      stageDeliveryCount: "2",
      stageDeliveries: [{ dpDate: "2026-07-10" }, { dpDate: "2026-07-20" }],
    }),
    "2026-07-20",
  );
});

test("non-staged S.O. export keeps its parent D.P.", () => {
  assert.equal(
    getQuickEntryExportDpDate({ dpDate: "2026-07-10", stageDelivery: "No" }),
    "2026-07-10",
  );
});

test("non-staged S.O. export uses revised D.P. when present", () => {
  assert.equal(
    getQuickEntryExportDpDate({ dpDate: "2026-07-10", revisedDp: "2026-08-10", stageDelivery: "No" }),
    "2026-08-10",
  );
});

test("collapsed S.O. amount uses the recorded order value once", () => {
  assert.equal(
    getQuickEntryExportSoAmount({
      soValueCapital: "100",
      stageDeliveries: [{ stageAmountCapital: "40" }, { stageAmountCapital: "60" }],
    }),
    100,
  );
});

test("collapsed S.O. amount can sum complete stage amounts when parent values are blank", () => {
  assert.equal(
    getQuickEntryExportSoAmount({
      soValueCapital: "",
      soValueRevenue: "",
      stageDelivery: "Yes",
      stageDeliveries: [
        { stageAmountCapital: "40", stageAmountRevenue: "" },
        { stageAmountCapital: "", stageAmountRevenue: "60" },
      ],
    }),
    100,
  );
});

test("S.O. amount components remain separate and aggregate only matching stage values", () => {
  const order = {
    stageDelivery: "Yes",
    stageDeliveries: [
      { stageAmountCapital: "40", stageAmountRevenue: "" },
      { stageAmountCapital: "60", stageAmountRevenue: "" },
    ],
  };

  assert.equal(getQuickEntryExportSoAmountComponent(order, "capital"), 100);
  assert.equal(getQuickEntryExportSoAmountComponent(order, "revenue"), undefined);
  assert.equal(getQuickEntryExportSoAmountComponent(order, "revenue", order.stageDeliveries[0]), undefined);
});

test("S.O. component selection does not return the opposite populated component", () => {
  const order = { soValueCapital: "", soValueRevenue: "250" };

  assert.equal(getQuickEntryExportSoAmountComponent(order, "capital"), undefined);
  assert.equal(getQuickEntryExportSoAmountComponent(order, "revenue"), 250);
});

test("collapsed S.O. amount ignores inactive stage records", () => {
  assert.equal(
    getQuickEntryExportSoAmount({
      stageDelivery: "No",
      stageDeliveries: [{ stageAmountCapital: "100" }],
    }),
    undefined,
  );
});

test("collapsed paid-to-date sums dated stagewise, advance, and supplementary actuals once", () => {
  assert.equal(
    getQuickEntryExportPaidSoFar({
      stageDelivery: "Yes",
      stagePayment: "Yes",
      advancePayment: "Yes",
      paymentDate: "2026-08-20",
      actualPaymentCapital: "999",
      stageDeliveries: [
        { paymentDate: "2026-08-10", actualPaymentCapital: "40" },
        { paymentDate: "2026-08-20", actualPaymentRevenue: "20" },
      ],
      advancePaymentDetail: { paymentDate: "2026-08-05", actualPaymentCapital: "10" },
      supplementaryBills: [{ paymentDate: "2026-08-25", actualPaymentCapital: "5" }],
    }),
    75,
  );
});

test("collapsed paid-to-date ignores stale advance payment when advance is not applicable", () => {
  assert.equal(
    getQuickEntryExportPaidSoFar({
      advancePayment: "No",
      advancePaymentDetail: { paymentDate: "2026-08-20", actualPaymentCapital: "500" },
    }),
    0,
  );
});

test("collapsed paid-to-date uses the common parent payment, not stale stage amounts", () => {
  assert.equal(
    getQuickEntryExportPaidSoFar({
      stageDelivery: "Yes",
      stagePayment: "No",
      paymentDate: "2026-08-20",
      actualPaymentCapital: "70",
      stageDeliveries: [{ paymentDate: "2026-08-10", actualPaymentCapital: "40" }],
    }),
    70,
  );
});

test("supplementary sent date in the first stage period maps to Stage 1", () => {
  assert.equal(
    getQuickEntrySupplementaryStageIndex("2026-06-01", [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
      { billPreparationDate: "2026-10-15" },
    ]),
    0,
  );
});

test("supplementary sent date in a later stage period maps to the preceding stage", () => {
  const stages = [
    { billPreparationDate: "2026-06-15" },
    { billPreparationDate: "2026-08-15" },
    { billPreparationDate: "2026-10-15" },
  ];
  assert.equal(getQuickEntrySupplementaryStageIndex("2026-07-01", stages), 0);
  assert.equal(getQuickEntrySupplementaryStageIndex("2026-09-01", stages), 1);
});

test("supplementary sent date at a stage boundary maps to the prior stage", () => {
  assert.equal(
    getQuickEntrySupplementaryStageIndex("2026-08-15", [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
      { billPreparationDate: "2026-10-15" },
    ]),
    0,
  );
});

test("supplementary sent date after the final stage maps to the final stage", () => {
  assert.equal(
    getQuickEntrySupplementaryStageIndex("2026-12-01", [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
      { billPreparationDate: "2026-10-15" },
    ]),
    2,
  );
});

test("supplementary bill without its sent date or any dated stages stays unassigned", () => {
  assert.equal(getQuickEntrySupplementaryStageIndex("", [{ billPreparationDate: "" }]), undefined);
  assert.equal(getQuickEntrySupplementaryStageIndex("2026-07-01", [{ billPreparationDate: "" }]), undefined);
});

test("collapsed export plans one supplementary row per bill", () => {
  assert.deepEqual(
    getQuickEntryExportRowPlan("collapsed", true, [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
    ], { supplementarySentDates: ["2026-07-01", "2026-09-01"] }),
    [
      { rowType: "S.O. summary" },
      { rowType: "Supplementary bill", supplementaryItemIndex: 0, stageIndex: 0 },
      { rowType: "Supplementary bill", supplementaryItemIndex: 1, stageIndex: 1 },
    ],
  );
});

test("expanded export keeps stages and supplementary bills on separate linked rows", () => {
  assert.deepEqual(
    getQuickEntryExportRowPlan("expanded", true, [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
      { billPreparationDate: "2026-10-15" },
    ], { supplementarySentDates: ["2026-07-01", "2026-09-01"] }),
    [
      { rowType: "S.O. summary" },
      { rowType: "Stage", stageIndex: 0 },
      { rowType: "Stage", stageIndex: 1 },
      { rowType: "Stage", stageIndex: 2 },
      { rowType: "Supplementary bill", supplementaryItemIndex: 0, stageIndex: 0 },
      { rowType: "Supplementary bill", supplementaryItemIndex: 1, stageIndex: 1 },
    ],
  );
});

test("two stages and two supplementary bills remain four independent child rows", () => {
  const rows = getQuickEntryExportRowPlan("expanded", true, [
    { billPreparationDate: "2026-06-15" },
    { billPreparationDate: "2026-08-15" },
  ], { supplementarySentDates: ["2026-07-01", "2026-09-01"] });

  assert.equal(rows.filter((row) => row.rowType === "Stage").length, 2);
  assert.equal(rows.filter((row) => row.rowType === "Supplementary bill").length, 2);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(1), [
    { rowType: "Stage", stageIndex: 0 },
    { rowType: "Stage", stageIndex: 1 },
    { rowType: "Supplementary bill", supplementaryItemIndex: 0, stageIndex: 0 },
    { rowType: "Supplementary bill", supplementaryItemIndex: 1, stageIndex: 1 },
  ]);
});

test("payment and advance records use independent rows with stage links", () => {
  assert.deepEqual(
    getQuickEntryExportRowPlan("expanded", true, [
      { billPreparationDate: "2026-06-15" },
      { billPreparationDate: "2026-08-15" },
    ], {
      stagePaymentIndexes: [0, 1],
      includeAdvance: true,
      supplementarySentDates: ["2026-07-01"],
    }),
    [
      { rowType: "S.O. summary" },
      { rowType: "Stage", stageIndex: 0 },
      { rowType: "Stage", stageIndex: 1 },
      { rowType: "Stage payment", stageIndex: 0 },
      { rowType: "Stage payment", stageIndex: 1 },
      { rowType: "Advance", stageIndex: 0 },
      { rowType: "Supplementary bill", supplementaryItemIndex: 0, stageIndex: 0 },
    ],
  );
});
