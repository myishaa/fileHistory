import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";

const settings = {
  selectedYear: "2025-26",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: [],
  firmTypes: ["MSE"],
  milestones: [],
};
const order = {
  id: "so1",
  financialSanctionDate: "2025-05-01",
  soNo: "SO1",
  soDate: "2025-05-03",
  soValueRevenue: "1000000",
  firm: "Firm A",
  firmType: "MSE",
  stageDelivery: "No",
  advancePayment: "No",
  soCancelled: "No",
};
const file = {
  id: "f1",
  division: "ACC",
  year: "2025-26",
  receivedDate: "2025-04-01",
  gem: "No",
  valueRevenue: "1000000",
  noOfSo: "1",
  completedMilestones: [],
};
const workflows = [
  {
    name: "contract Job Completion",
    fileType: "AMC",
    fileTypeGroup: "contract",
    ir: "No",
    field: "jobCompletionDate",
    prefix: "jobCompletion",
    pendingKey: "jobCompletionPendingByFyEnd",
  },
  {
    name: "Goods & Services Job Completion",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    ir: "No",
    field: "jobCompletionDate",
    prefix: "jobCompletion",
    pendingKey: "jobCompletionPendingByFyEnd",
  },
  {
    name: "Material Receipt",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    ir: "Yes",
    field: "materialReceiptDate",
    prefix: "delivery",
    pendingKey: "materialReceiptPendingByFyEnd",
  },
];

function summary(workflow, orders, extra = {}) {
  const candidate = {
    ...file,
    fileType: workflow.fileType,
    fileTypeGroup: workflow.fileTypeGroup,
    ir: workflow.ir,
    noOfSo: String(orders.length),
    supplyOrders: orders,
    ...extra,
  };
  return buildDashboardSummary({
    files: [candidate],
    financeFiles: [candidate],
    divisions: [],
    settings,
    finance1Year: "2025-26",
    finance1AsOfDate: "2026-11-09",
  }).finance1Summary;
}

function workOrders(workflow, model, dates) {
  if (model === "ordinary S.O.s") {
    return dates.map((date, index) => ({
      ...order,
      id: `so${index + 1}`,
      soNo: `SO${index + 1}`,
      [workflow.field]: date,
    }));
  }
  return [
    {
      ...order,
      stageDelivery: "Yes",
      stageDeliveryCount: String(dates.length),
      stagePayment: model === "staged payments" ? "Yes" : "No",
      stageDeliveries: dates.map((date, index) => ({
        id: `stage${index + 1}`,
        [workflow.field]: date,
      })),
    },
  ];
}

function assertGroups(result, workflow, { pending, later, still }) {
  const ids = result.drillFileIds;
  assert.deepEqual(ids[workflow.pendingKey] ?? [], pending ? [file.id] : []);
  assert.deepEqual(ids.deliveryJobPendingByFyEnd ?? [], pending ? [file.id] : []);
  assert.deepEqual(ids[`${workflow.prefix}PendingCompletedLater`] ?? [], later ? [file.id] : []);
  assert.deepEqual(ids[`${workflow.prefix}PendingStillOpenToday`] ?? [], still ? [file.id] : []);
  assert.deepEqual(ids.deliveryJobPendingCompletedLater ?? [], later ? [file.id] : []);
  assert.deepEqual(ids.deliveryJobPendingStillOpenToday ?? [], still ? [file.id] : []);
}

for (const workflow of workflows) {
  for (const model of ["ordinary S.O.s", "staged payments", "common payment"]) {
    test(`${workflow.name}: ${model} retain pending work independently of completed items`, () => {
      const cases = [
        { dates: ["2026-02-01", undefined, undefined], pending: true, later: false, still: true },
        { dates: ["2026-02-01", "2026-05-01", undefined], pending: true, later: true, still: true },
        {
          dates: ["2026-02-01", "2026-05-01", "2026-06-01"],
          pending: true,
          later: true,
          still: false,
        },
        {
          dates: ["2026-02-01", "2026-03-01", "2026-03-31"],
          pending: false,
          later: false,
          still: false,
        },
        {
          dates: ["2026-02-01", "2027-01-01", undefined],
          pending: true,
          later: false,
          still: true,
        },
      ];
      for (const { dates, ...expected } of cases) {
        const result = summary(workflow, workOrders(workflow, model, dates));
        assertGroups(result, workflow, expected);
        assert.equal(result.deliveryJobDoneByFyEnd, 1);
      }
    });
  }
}

test("a later completion belongs to the item unfinished at cutoff, not another S.O.", () => {
  const workflow = workflows[0];
  const result = summary(workflow, [
    { ...order, jobCompletionDate: "2026-02-01" },
    { ...order, id: "pending", soNo: "PENDING" },
    {
      ...order,
      id: "later-order",
      soNo: "LATER",
      soDate: "2026-04-01",
      jobCompletionDate: "2026-05-01",
    },
  ]);
  assertGroups(result, workflow, { pending: true, later: false, still: true });
});

test("stage dates take precedence over parent completion and missing declared stages stay pending", () => {
  for (const workflow of workflows) {
    const staged = {
      ...order,
      stageDelivery: "Yes",
      stageDeliveryCount: "3",
      stagePayment: "No",
      [workflow.field]: "2026-02-01",
      stageDeliveries: [{ [workflow.field]: "2026-02-01" }],
    };
    assertGroups(summary(workflow, [staged]), workflow, {
      pending: true,
      later: false,
      still: true,
    });
    assertGroups(summary(workflow, [{ ...staged, stageDeliveries: [] }]), workflow, {
      pending: true,
      later: false,
      still: true,
    });
    // A retained record beyond the declared stage count is not an applicable stage.
    assertGroups(
      summary(workflow, [
        {
          ...staged,
          stageDeliveryCount: "1",
          stageDeliveries: [{ [workflow.field]: "2026-02-01" }, {}],
        },
      ]),
      workflow,
      { pending: false, later: false, still: false },
    );
  }
});

test("only the applicable completion field and active stage-delivery mode clear pending work", () => {
  for (const workflow of workflows) {
    const otherField =
      workflow.field === "jobCompletionDate" ? "materialReceiptDate" : "jobCompletionDate";
    const result = summary(workflow, [
      {
        ...order,
        [otherField]: "2026-02-01",
        stageDeliveries: [{ [workflow.field]: "2026-02-01" }],
      },
    ]);
    assertGroups(result, workflow, { pending: true, later: false, still: true });
    assert.equal(result.deliveryJobDoneByFyEnd, 0);
  }
});

test("pending delivery work still requires an eligible order placed and not cancelled at cutoff", () => {
  const workflow = workflows[0];
  for (const changes of [
    { financialSanctionDate: "" },
    { soNo: "" },
    { soDate: "" },
    { soDate: "2026-04-01" },
    { soCancelled: "Yes", soCancelledDate: "2026-03-01" },
  ]) {
    assertGroups(summary(workflow, [{ ...order, ...changes }]), workflow, {
      pending: false,
      later: false,
      still: false,
    });
  }
});

test("current FY pending work uses today's cutoff and does not treat future completion as done", () => {
  const workflow = workflows[0];
  const currentFile = {
    ...file,
    fileType: "AMC",
    fileTypeGroup: "contract",
    ir: "No",
    year: "2026-27",
    receivedDate: "2026-04-01",
    supplyOrders: [
      {
        ...order,
        financialSanctionDate: "2026-05-01",
        soDate: "2026-05-03",
        stageDelivery: "Yes",
        stageDeliveryCount: "2",
        stagePayment: "Yes",
        stageDeliveries: [{ jobCompletionDate: "2026-10-01" }, { jobCompletionDate: "2026-12-01" }],
      },
    ],
  };
  const result = buildDashboardSummary({
    files: [currentFile],
    financeFiles: [currentFile],
    divisions: [],
    settings: { ...settings, selectedYear: "2026-27" },
    finance1Year: "2026-27",
    finance1AsOfDate: "2026-11-09",
  }).finance1Summary;
  assert.equal(result.cutoffDate, "2026-11-09");
  assertGroups(result, workflow, { pending: true, later: false, still: true });
});
