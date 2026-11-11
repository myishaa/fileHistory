import assert from "node:assert/strict";
import test from "node:test";
import { dashboardHarness, descendants } from "./helpers/dashboard-review-harness.mjs";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import * as frontend from "../src/lib/effective-deliveries.ts";
import * as backend from "../backend/src/utils/effective-deliveries.ts";
import { getStatus4CurrentFiles, getStatus4RequestKey } from "../src/lib/status4-request-state.ts";

const { env, payload } = await dashboardHarness();
const order = {
  id: "order-1",
  financialSanctionDate: "2026-04-03",
  soNo: "SO1",
  soDate: "2026-04-04",
  soValueRevenue: "100000",
  firm: "Firm A",
  firmType: "MSE",
  stageDelivery: "No",
  advancePayment: "No",
};
const file = {
  id: "file-1",
  division: "ACC",
  year: "2026-27",
  receivedDate: "2026-04-01",
  fileType: "Goods & Services",
  fileTypeGroup: "goodsServices",
  gem: "No",
  ir: "No",
  noOfSo: "1",
  valueRevenue: "100000",
  biddingStageOver: "Yes",
  supplyOrders: [order],
};
const settings = {
  selectedYear: "__all_files__",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: [],
  firmTypes: [],
  milestones: ["Financial Sanction", "Supply Order", "PWB"],
};
const summary = (files) => buildDashboardSummary({ files, divisions: [], settings });

test("Status-1 history excludes stage payments after cancellation or file closure", () => {
  env.fileMatchesInitiationDateRange = () => true;
  const stagedOrder = {
    ...order,
    stageDelivery: "Yes",
    stageDeliveryCount: "2",
    stagePayment: "Yes",
    stageDeliveries: [
      { stageAmountRevenue: "50000", paymentDate: "2026-06-08" },
      { stageAmountRevenue: "50000", paymentDate: "2026-06-15" },
    ],
  };
  const cases = [
    {
      view: "cancelled",
      record: {
        ...file,
        supplyOrders: [{ ...stagedOrder, soCancelled: "Yes", soCancelledDate: "2026-06-10" }],
      },
    },
    {
      view: "closed",
      record: {
        ...file,
        completedMilestones: ["File Closed"],
        fileClosureDate: "2026-06-10",
        supplyOrders: [stagedOrder],
      },
    },
  ];

  for (const { view, record } of cases) {
    const { workflowFiles } = env.buildStatus1HistoricalDataset(
      [record], view, "", "", "all",
    );
    assert.equal(workflowFiles.length, 1);
    assert.equal(env.countPaymentCompletedOrders(workflowFiles), 1);
    assert.equal(workflowFiles[0].supplyOrders[0].stageDeliveries[0].paymentDate, "2026-06-08");
    assert.equal(workflowFiles[0].supplyOrders[0].stageDeliveries[1].paymentDate, "");
    assert.equal(record.supplyOrders[0].stageDeliveries[1].paymentDate, "2026-06-15");
  }
});

test("Status-1 history excludes supplementary payments after cancellation or file closure", () => {
  env.fileMatchesInitiationDateRange = () => true;
  const orderWithSupplementaryBills = {
    ...order,
    supplementaryBills: [
      { billNo: "SUP-1", paymentDate: "2026-06-08" },
      { billNo: "SUP-2", paymentDate: "2026-06-15" },
    ],
  };
  const cases = [
    {
      view: "cancelled",
      record: {
        ...file,
        supplyOrders: [
          { ...orderWithSupplementaryBills, soCancelled: "Yes", soCancelledDate: "2026-06-10" },
        ],
      },
    },
    {
      view: "closed",
      record: {
        ...file,
        completedMilestones: ["File Closed"],
        fileClosureDate: "2026-06-10",
        supplyOrders: [orderWithSupplementaryBills],
      },
    },
  ];

  for (const { view, record } of cases) {
    const { workflowFiles } = env.buildStatus1HistoricalDataset(
      [record], view, "", "", "all",
    );
    assert.equal(workflowFiles.length, 1);
    assert.equal(env.countSupplementaryBillPaidOrders(workflowFiles), 1);
    assert.equal(workflowFiles[0].supplyOrders[0].supplementaryBills[0].paymentDate, "2026-06-08");
    assert.equal(workflowFiles[0].supplyOrders[0].supplementaryBills[1].paymentDate, "");
    assert.equal(record.supplyOrders[0].supplementaryBills[1].paymentDate, "2026-06-15");
  }
});

test("Status-1 history cuts off nested advance and bill-return events", () => {
  env.fileMatchesInitiationDateRange = () => true;
  const record = {
    ...file,
    supplyOrders: [{
      ...order,
      advancePayment: "Yes",
      advancePaymentDetail: {
        paymentDate: "2026-06-15",
        billReturnCycles: [{ returnedDate: "2026-06-09", resubmittedDate: "2026-06-15" }],
      },
      billReturnCycles: [{ returnedDate: "2026-06-09", resubmittedDate: "2026-06-15" }],
      supplementaryBills: [{
        billNo: "SUP-1",
        billReturnCycles: [{ returnedDate: "2026-06-09", resubmittedDate: "2026-06-15" }],
      }],
      soCancelled: "Yes",
      soCancelledDate: "2026-06-10",
    }],
  };
  const { workflowFiles } = env.buildStatus1HistoricalDataset([record], "cancelled", "", "", "all");
  const historical = workflowFiles[0].supplyOrders[0];
  assert.equal(historical.advancePaymentDetail.paymentDate, "");
  assert.equal(historical.advancePaymentDetail.billReturnCycles[0].returnedDate, "2026-06-09");
  assert.equal(historical.advancePaymentDetail.billReturnCycles[0].resubmittedDate, "");
  assert.equal(historical.billReturnCycles[0].resubmittedDate, "");
  assert.equal(historical.supplementaryBills[0].billReturnCycles[0].resubmittedDate, "");
  assert.equal(record.supplyOrders[0].advancePaymentDetail.paymentDate, "2026-06-15");
});

test("Cancelled Status-1 history keeps received BGs due for return as of cancellation", () => {
  env.fileMatchesInitiationDateRange = () => true;
  for (const { key, coverage, receivedField, returnField } of [
    { key: "psb", coverage: "PSB", receivedField: "psbBgReceivedDate", returnField: "psbBgReturnDate" },
    { key: "pwb", coverage: "PWB", receivedField: "pwbBgReceivedDate", returnField: "pwbBgReturnDate" },
    { key: "psbPwb", coverage: "PSB+PWB", receivedField: "combinedBgReceivedDate", returnField: "combinedBgReturnDate" },
  ]) {
    const cancelledFile = {
      ...file,
      bg: "Yes",
      supplyOrders: [{
        ...order,
        soCancelled: "Yes",
        soCancelledDate: "2026-06-10",
        bgCoverageType: coverage,
        psbApplicable: "Yes",
        [receivedField]: "2026-06-08",
        [returnField]: "2026-06-15",
      }],
    };
    const { workflowFiles } = env.buildStatus1HistoricalDataset(
      [cancelledFile], "cancelled", "", "", "all",
    );
    assert.equal(workflowFiles[0].supplyOrders[0][returnField], "");
    assert.equal(env.countHistoricalCancelledBgToBeReturnedOrders(workflowFiles, key), 1);
    assert.equal(
      env.getHistoricalStatusFlow(workflowFiles, "cancelled").find((item) => item.key === key)
        ?.bgToBeReturned,
      1,
    );

    cancelledFile.supplyOrders[0][returnField] = "2026-06-09";
    const returned = env.buildStatus1HistoricalDataset(
      [cancelledFile], "cancelled", "", "", "all",
    );
    assert.equal(env.countHistoricalCancelledBgToBeReturnedOrders(returned.workflowFiles, key), 0);
  }
});

test("Cancelled-history Search focuses the selected cancelled S.O. indexes", () => {
  const mixedFile = {
    ...file,
    noOfSo: "3",
    supplyOrders: [
      { ...order, id: "live", soCancelled: "No" },
      { ...order, id: "cancelled-june", soCancelled: "Yes", soCancelledDate: "2026-06-10" },
      { ...order, id: "cancelled-july", soCancelled: "Yes", soCancelledDate: "2026-07-15" },
    ],
  };
  assert.equal(
    env.serializeStatus1CancelledFocusTargets(
      [mixedFile], new Set([mixedFile.id]), "2026-06-01", "2026-06-30",
    ),
    `${mixedFile.id}=socancelled%3Ayes%3A1`,
  );
  assert.equal(
    env.serializeStatus1CancelledFocusTargets(
      [mixedFile], new Set([mixedFile.id]), "", "",
    ),
    `${mixedFile.id}=socancelled%3Ayes%3A1%7Csocancelled%3Ayes%3A2`,
  );
  assert.equal(
    env.serializeStatus1CancelledFocusTargets([mixedFile], new Set(), "", ""),
    undefined,
  );
});

test("Cancelled-history payment link focuses the order that contributed the payment", () => {
  env.fileMatchesInitiationDateRange = () => true;
  const mixedFile = {
    ...file,
    noOfSo: "2",
    supplyOrders: [
      { ...order, id: "unpaid", soCancelled: "Yes", soCancelledDate: "2026-06-10" },
      { ...order, id: "paid", paymentDate: "2026-06-08", soCancelled: "Yes", soCancelledDate: "2026-06-10" },
    ],
  };
  const { workflowFiles } = env.buildStatus1HistoricalDataset(
    [mixedFile], "cancelled", "", "", "all",
  );
  assert.equal(
    env.serializeStatus1CancelledFocusTargets(
      [mixedFile], new Set([mixedFile.id]), "", "", "milestoneCleared:payment", workflowFiles,
    ),
    `${mixedFile.id}=socancelled%3Ayes%3A1`,
  );
});

test("a changed Status-4 scope immediately rejects old files, even before the effect starts", () => {
  const scope = {
    userId: "a",
    selectedYear: "__all_active_files__",
    includeArchivedYears: true,
    includeAllCancelledSupplyOrderFiles: true,
    refreshRevision: 0,
  };
  const key = getStatus4RequestKey(scope),
    result = { requestKey: key, files: [file] };
  assert.equal(getStatus4CurrentFiles(result, key), result.files);
  for (const change of [
    { userId: "b" },
    { selectedYear: "2025-26" },
    { includeArchivedYears: false },
    { includeAllCancelledSupplyOrderFiles: false },
    { refreshRevision: 1 },
  ]) {
    assert.equal(
      getStatus4CurrentFiles(result, getStatus4RequestKey({ ...scope, ...change })),
      undefined,
    );
  }
  assert.equal(getStatus4CurrentFiles(undefined, key), undefined);
  assert.deepEqual(getStatus4CurrentFiles({ requestKey: key, files: [] }, key), []);
});

test("Status-4 loading/errors hide data links and disable exports; ready results enable them", () => {
  const props = {
    files: [file],
    milestones: [{ name: "Supply Order", label: "Supply Order" }],
    visibleMilestoneNames: ["Supply Order"],
    totalFiles: 1,
    totalSupplyOrders: 1,
    valueThresholdLevels: [],
    drill: {},
    sortKey: "label",
    sortDirection: "asc",
    onDrillChange() {},
    onSortChange() {},
    onCountClick() {},
  };
  for (const state of [
    { loading: true },
    { loading: false, error: "Unavailable" },
    { loading: false },
  ]) {
    const nodes = descendants(env.Status4Section({ ...props, ...state }));
    const buttons = nodes.filter(
      (node) =>
        node.type === "button" &&
        /exportStatus4RowsToExcel|printStatus4RowsToPdf/.test(String(node.props.onClick)),
    );
    assert.equal(buttons.length, 2);
    const ready = !state.loading && !state.error;
    assert.ok(buttons.every((button) => button.props.disabled === !ready));
    assert.equal(
      nodes.some((node) => node.type === env.Status4Table),
      ready,
    );
  }
});

test("Unmatched links use only contributing file IDs for the clicked metric", () => {
  const rows = env.getStatus4ThresholdRows(
    [
      { ...file, id: "inside", valueRevenue: "50000", cfaDate: "2026-04-01" },
      { ...file, id: "outside-cleared", valueRevenue: "200000", cfaDate: "2026-04-01" },
      { ...file, id: "outside-pending", valueRevenue: "200000" },
    ],
    [{ name: "CFA", label: "CFA" }],
    [{ key: "one", label: "0–1 L", sortValue: 0, minValue: 0, maxValue: 100000 }],
    "2026-27",
  );
  const row = rows.find((row) => row.unmatched);
  let target;
  const nodes = descendants(
    env.Status4MetricCell({
      metrics: row.metrics.CFA,
      milestone: "CFA",
      fiscalYear: row.fiscalYear,
      files: row.files,
      onCountClick(value) {
        target = value;
      },
    }),
  );
  nodes.find((node) => node.props?.["aria-label"] === "Cleared: 1").props.onClick();
  assert.deepEqual([...target.fileIds], ["outside-cleared"]);
  assert.equal(env.getStatus4DashboardFilter(target), "fileIds:outside-cleared");
});

test("Status-4 exports preserve the selected orientation and stack, with charts and totals in PDF and Excel", async () => {
  const props = {
    files: [file],
    milestones: [{ name: "Supply Order", label: "Supply Order" }],
    visibleMilestoneNames: ["Supply Order"],
    totalFiles: 1,
    totalSupplyOrders: 1,
    valueThresholdLevels: [],
    drill: {},
    sortKey: "label",
    sortDirection: "asc",
    loading: false,
    onDrillChange() {},
    onSortChange() {},
    onCountClick() {},
  };
  for (const view of ["bar", "column"]) {
    env.useState = (initial) => [initial === "table" ? view : initial, () => {}];
    const nodes = descendants(env.Status4Section(props));
    for (const action of ["printStatus4RowsToPdf", "exportStatus4RowsToExcel"]) {
      nodes
        .find((node) => node.type === "button" && String(node.props.onClick).includes(action))
        .props.onClick();
      const output = payload();
      assert.equal(output.plot.orientation, view === "bar" ? "horizontal" : "vertical");
      assert.equal(output.plot.stackedBars, true);
      const detailTable = output.tables.at(-1);
      assert.ok(detailTable.rows.at(-1).includes("Total"));
      assert.equal(detailTable.rows.at(-1)[output.format === "pdf" ? 2 : 1], 1);
    }
  }
  env.useState = (initial) => [initial, () => {}];
});

test("F.S.-only rows retain completion and pending S.O. work without becoming placed orders", () => {
  const pendingOrder = { financialSanctionDate: "2026-04-03", currentMilestone: "Supply Order" };
  const pendingFile = { ...file, supplyOrders: [pendingOrder] };
  for (const helpers of [frontend, backend]) {
    assert.equal(helpers.expectedSupplyOrders(pendingFile)[0].financialSanctionDate, "2026-04-03");
    assert.equal(helpers.eligibleSupplyOrders(pendingFile).length, 0);
    assert.equal(
      helpers.isSupplyOrderMilestoneCurrent(pendingFile, pendingOrder, "Supply Order"),
      true,
    );
    assert.equal(
      helpers.isSupplyOrderMilestoneCurrent(
        pendingFile,
        {
          ...pendingOrder,
          currentMilestone: "Financial Sanction",
        },
        "Financial Sanction",
      ),
      false,
    );
  }
  const result = summary([pendingFile]);
  assert.equal(result.statusFlow.find((row) => row.key === "supplyOrder").pending, 1);
  assert.equal(result.statusFlow.find((row) => row.key === "financialSanction").cleared, 1);
  assert.equal(result.dashboardSupplyOrderCount, 0);
  assert.equal(env.getStatus4MilestoneMetrics([pendingFile], "Financial Sanction").cleared, 1);
  assert.equal(env.getStatus4MilestoneMetrics([pendingFile], "Financial Sanction").current, 0);
});

test("Status-4 keeps eligible cancelled S.O. placement history in Cleared", () => {
  const cancelledFile = {
    ...file,
    supplyOrders: [{ ...order, soCancelled: "Yes" }],
  };
  const cancelledMetrics = env.getStatus4MilestoneMetrics([cancelledFile], "Supply Order");
  assert.equal(cancelledMetrics.applicable, 1);
  assert.equal(cancelledMetrics.cleared, 1);
  assert.equal(cancelledMetrics.current, 0);

  const incompleteCancelledFile = {
    ...file,
    supplyOrders: [{ soDate: order.soDate, soCancelled: "Yes" }],
  };
  const incompleteMetrics = env.getStatus4MilestoneMetrics(
    [incompleteCancelledFile],
    "Supply Order",
  );
  assert.equal(incompleteMetrics.applicable, 1);
  assert.equal(incompleteMetrics.cleared, 0);
  assert.equal(incompleteMetrics.current, 0);
});

test("BG Expiry retains an outstanding BG on a cancelled S.O. without broadening other cards", () => {
  const expiredBgFile = {
    ...file,
    bg: "Yes",
    supplyOrders: [
      {
        ...order,
        soCancelled: "Yes",
        psbApplicable: "Yes",
        bgCoverageType: "PSB",
        psbBgReceivedDate: "2026-05-01",
        psbBgValidityDate: "2026-06-01",
        psbBgReturnDate: "",
        jobCompletionDate: "",
      },
    ],
  };
  const result = buildDashboardSummary({
    files: [],
    bgExpiryFiles: [expiredBgFile],
    divisions: [],
    settings,
  });
  const psb = result.statusFlow.find((row) => row.key === "psb");
  assert.equal(psb?.bgExpired, 1);
  assert.equal(psb?.bgToBeReturned, 1);
  assert.equal(psb?.total, 0);
  assert.equal(psb?.cleared, 0);
});

test("PWB follows all stage completions and counts one BG per S.O.; stopped/partial orders stay out", () => {
  for (const ir of ["Yes", "No"]) {
    const field = ir === "Yes" ? "irReceiptDate" : "actualJobCompletionDate";
    const stagedOrder = {
      ...order,
      stageDelivery: "Yes",
      stageDeliveryCount: "2",
      stagePayment: "No",
      bgCoverageType: "PWB",
      stageDeliveries: [{ [field]: "2026-05-01" }, { [field]: "2026-06-01" }],
    };
    const stagedFile = { ...file, ir, bg: "Yes", supplyOrders: [stagedOrder] };
    for (const helpers of [frontend, backend])
      assert.equal(helpers.isPwbFollowUpStarted(stagedFile, stagedOrder), true);
    assert.equal(summary([stagedFile]).statusFlow.find((row) => row.key === "pwb").pending, 1);
    assert.equal(
      searchFiles([stagedFile], { dashboardFilter: "manualMilestoneCurrent:PWB" }).length,
      1,
    );
    if (ir === "Yes") {
      const materialOnlyOrder = {
        ...stagedOrder,
        stageDeliveries: [{ materialReceiptDate: "2026-05-01" }, { materialReceiptDate: "2026-06-01" }],
      };
      const materialOnlyFile = { ...stagedFile, supplyOrders: [materialOnlyOrder] };
      for (const helpers of [frontend, backend])
        assert.equal(helpers.isPwbFollowUpStarted(materialOnlyFile, materialOnlyOrder), false);
      assert.equal(summary([materialOnlyFile]).statusFlow.find((row) => row.key === "pwb").pending, 0);
      assert.equal(
        searchFiles([materialOnlyFile], { dashboardFilter: "manualMilestoneCurrent:PWB" }).length,
        0,
      );
    }
    for (const change of [
      { stageDeliveries: [{ [field]: "2026-05-01" }, {}] },
      { soCancelled: "Yes" },
      { noFurtherAction: "Yes" },
      { soNo: "" },
      { pwbBgReceivedDate: "2026-07-01" },
    ]) {
      const modified = { ...stagedFile, supplyOrders: [{ ...stagedOrder, ...change }] };
      assert.equal(summary([modified]).statusFlow.find((row) => row.key === "pwb").pending, 0);
    }
  }
});

test("IR pending counts keep shortclosed work until No Further Action", () => {
  const shortclosedOrder = {
    ...order,
    materialReceiptDate: "2026-05-01",
    shortclosure: "Yes",
    noFurtherAction: "No",
  };
  const shortclosedFile = { ...file, ir: "Yes", supplyOrders: [shortclosedOrder] };
  const backendIr = summary([shortclosedFile]).statusFlow.find((row) => row.key === "ir");

  assert.equal(backendIr?.irPreparationPending, 1);
  assert.equal(env.countIrPreparationPendingOrders([shortclosedFile]), 1);
  assert.equal(
    env.countIrPreparationPendingOrders([
      { ...shortclosedFile, supplyOrders: [{ ...shortclosedOrder, noFurtherAction: "Yes" }] },
    ]),
    0,
  );
});

test("stage LD opens its contributing file and incomplete orders do not contribute", () => {
  const staged = {
    ...file,
    supplyOrders: [
      {
        ...order,
        stageDelivery: "Yes",
        stagePayment: "Yes",
        stageDeliveryCount: "2",
        stageDeliveries: [{ ld: "Yes" }, { ld: "No" }],
      },
    ],
  };
  assert.equal(summary([staged]).miscellaneousCounts.ld, 1);
  assert.equal(searchFiles([staged], { dashboardFilter: "miscLd" }).length, 1);
  assert.equal(
    searchFiles([{ ...staged, supplyOrders: [{ ...staged.supplyOrders[0], soNo: "" }] }], {
      dashboardFilter: "miscLd",
    }).length,
    0,
  );
});

test("Status-3 supplementary resubmissions use their own field and Advance Paid has a supported target", async () => {
  const paymentFile = {
    ...file,
    supplyOrders: [
      {
        ...order,
        billSentForPaymentDate: "2026-06-01",
        billReturnCycles: [{ returnedDate: "2026-06-02", resubmittedDate: "2026-06-03" }],
        supplementaryBills: [1, 2].map((number) => ({
          billNo: `S${number}`,
          billSentForPaymentDate: "2026-07-01",
          billReturnCycles: [{ returnedDate: "2026-07-02", resubmittedDate: "2026-07-03" }],
        })),
      },
    ],
  };
  const result = summary([paymentFile]);
  const presentation = env.getStatus3Presentation(
    env.combineJobCompletionAndIr(result.statusFlow),
    result.miscellaneousCounts,
  );
  assert.equal(
    presentation.exportGroups.find((group) => group.title === "Supplementary Bill").rows[0].counts[
      "Resubmitted and unpaid"
    ],
    2,
  );
  for (const format of ["pdf", "excel"]) {
    await env.downloadStatusSummaryGroups(presentation.exportGroups, "Status-3", format);
    const table = payload().tables.find((table) => table.title === "Supplementary Bill");
    assert.equal(table.rows[0][table.headers.indexOf("Resubmitted and unpaid")], 2);
  }
  const target = env.getStatus3OpenTarget("Advance Payment", "Advance Paid");
  assert.equal(env.getStatusSummaryDashboardFilter(target.milestone, target.stage), "advancePaid");
});

test("Status-3 exports remain disabled until matching results are ready", () => {
  const result = summary([file]),
    props = {
      milestones: result.statusFlow,
      miscellaneousCounts: result.miscellaneousCounts,
      totalFiles: 1,
      totalSupplyOrders: 1,
      onOpenStatus() {},
    };
  for (const state of [
    { loading: true },
    { loading: false, error: "Unavailable" },
    { loading: false },
  ]) {
    const buttons = descendants(env.DashboardStatusSummarySection({ ...props, ...state })).filter(
      (node) =>
        node.type === "button" &&
        /printStatusSummaryGroupsToPdf|exportStatusSummaryGroupsToExcel/.test(
          String(node.props.onClick),
        ),
    );
    assert.equal(buttons.length, 2);
    assert.ok(
      buttons.every((button) => button.props.disabled === Boolean(state.loading || state.error)),
    );
  }
});

test("Status-1 exports include Pre-Bid, Job Completion, and the separate F.S./S.O. figures", () => {
  const result = summary([
    { ...file, noOfSo: "2", supplyOrders: [order, { ...order, id: "second" }] },
  ]);
  const flow = env.combineJobCompletionAndIr(result.statusFlow);
  const rows = env.getStatusPageExportRows(flow, result.miscellaneousCounts, 1);
  const value = (section, metric) =>
    rows.find((row) => row.section === section && row.metric === metric)?.count;
  assert.equal(value("Financial Sanction", "Completed (Files)"), 1);
  assert.equal(value("Financial Sanction", "Completed (F.S.)"), 2);
  assert.equal(value("Supply Order", "Placed (Files)"), 1);
  assert.equal(value("Supply Order", "Placed (S.O.)"), 2);
  assert.equal(value("Miscellaneous", "Multiple S.O. (Files)"), 1);
  assert.equal(value("Miscellaneous", "Multiple S.O. (S.O.)"), 2);
  assert.equal(value("Job Completion / IR", "Job Completion Due"), 0);
  assert.equal(value("Job Completion / IR", "Job Completion Done"), 0);
  for (const metric of ["Due", "Completed", "Refloat Due", "Refloat Completed"])
    assert.equal(value("Pre-Bid Meeting", metric), 0);
});

test("cancellation drill-throughs carry exact Dashboard contributors while unrelated filters are preserved", () => {
  const mixed = { ...file, noOfSo: "2", supplyOrders: [order, { ...order, soCancelled: "Yes" }] };
  assert.equal(env.getStatusCancellationScopeFilter("miscSoCancelled", [mixed]), "fileIds:file-1");
  assert.equal(env.getStatusCancellationScopeFilter("miscSoCancelled", [file]), "fileIds:");
  assert.equal(
    env.getStatusCancellationScopeFilter("miscDemandCancelled", [
      { ...file, demandCancelled: "Yes" },
    ]),
    "fileIds:file-1",
  );
  assert.equal(env.getStatusCancellationScopeFilter("miscLd", [mixed]), "miscLd");
});
