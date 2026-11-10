import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getSnapshotSummary } from "../src/lib/snapshot-summary-state.ts";
import {
  getDashboardActivitySummaryState,
  getDashboardActivitySummaryStatusText,
} from "../src/lib/dashboard-activity-summary-state.ts";

const backendActivitySummary = {
  activityCountsForFileScope: {
    supplyOrdersPlacedInSelectedFy: 3,
    liveSupplyOrdersPlacedInSelectedFy: 2,
    filesClosedInSelectedFy: 1,
  },
  activityCountsForFileScopeByInitiationYear: [],
};

test("activity summary stays loading before the backend response arrives", () => {
  assert.equal(getDashboardActivitySummaryState(undefined, { loading: true }), "loading");
  assert.equal(getDashboardActivitySummaryStatusText("loading"), "Loading activity summary…");
});

test("activity summary reports unavailable when the backend request fails", () => {
  assert.equal(
    getDashboardActivitySummaryState(undefined, {
      loading: false,
      error: "Dashboard summary request failed.",
    }),
    "unavailable",
  );
  assert.equal(getDashboardActivitySummaryStatusText("unavailable"), "Unavailable");
});

test("missing backend activity counts do not use a local fallback", () => {
  const localFallback = { activityCounts: { supplyOrdersPlacedInSelectedFy: 99 } };

  assert.equal(getDashboardActivitySummaryState(localFallback, { loading: false }), "unavailable");
});

test("activity summary becomes ready when the authoritative backend data arrives", () => {
  assert.equal(
    getDashboardActivitySummaryState(backendActivitySummary, { loading: false }),
    "ready",
  );
});

test("a refresh keeps exports unavailable even with a previous summary", () => {
  assert.equal(
    getDashboardActivitySummaryState(backendActivitySummary, { loading: true }),
    "loading",
  );
});

test("a refresh error invalidates the last successful activity summary", () => {
  assert.equal(
    getDashboardActivitySummaryState(backendActivitySummary, {
      loading: false,
      error: "Dashboard summary request failed.",
    }),
    "unavailable",
  );
});

// Exercise the page's actual readiness wiring, including the interval before
// the request effect sets loading and a retained summary from an older refresh.
const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
  ts.forEachChild(node, visit);
}
visit(ast);
const readinessCode = ts.transpileModule(
  [
    "snapshotSummary",
    "finance1ExportReady",
    "finance1ActivitySummaryState",
    "finance1ActivitySummaryReady",
  ]
    .map((name) => `const ${declarations.get(name).getText(ast)};`)
    .join("\n") +
    "\n({ ready: finance1ActivitySummaryReady, state: finance1ActivitySummaryState, snapshotExportReady: finance1ExportReady });",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

const request = { query: "selectedYear=2026-27", userId: "editor-1", refreshRevision: 0 };
const result = { ...request, summary: { finance1Summary: backendActivitySummary } };
function pageReadiness(currentResult, currentRequest = request, status = {}) {
  return vm.runInNewContext(readinessCode, {
    getSnapshotSummary,
    getDashboardActivitySummaryState,
    dashboardSummaryState: currentResult,
    dashboardSummaryQuery: currentRequest.query,
    activeUser: { id: currentRequest.userId },
    dashboardCalculationNonce: currentRequest.refreshRevision,
    dashboardSummaryLoading: status.loading ?? false,
    dashboardSummaryError: status.error,
    backendFinance1Summary: currentResult?.summary.finance1Summary,
  });
}

test("FY Activity and FY Snapshot immediately disable exports for a new refresh, scope, or account", () => {
  assert.equal(pageReadiness(result).ready, true);
  assert.equal(pageReadiness(result).snapshotExportReady, true);
  for (const change of [
    { refreshRevision: 1 },
    { query: "selectedYear=2025-26" },
    { query: `${request.query}&includeArchivedYears=false` },
    { query: `${request.query}&includeAllCancelledSupplyOrderFiles=false` },
    { userId: "editor-2" },
  ]) {
    const state = pageReadiness(result, { ...request, ...change });
    assert.equal(state.ready, false);
    assert.equal(state.snapshotExportReady, false);
    assert.equal(state.state, "loading");
  }
});

test("FY Activity and FY Snapshot stay disabled during loading and after failure or Stop, then recover on success", () => {
  const refreshedRequest = { ...request, refreshRevision: 1 };
  assert.equal(pageReadiness(result, refreshedRequest, { loading: true }).ready, false);
  assert.equal(
    pageReadiness(result, refreshedRequest, { loading: true }).snapshotExportReady,
    false,
  );
  for (const error of ["Dashboard summary request failed.", "Calculation stopped."]) {
    const state = pageReadiness(result, refreshedRequest, { error });
    assert.equal(state.ready, false);
    assert.equal(state.snapshotExportReady, false);
    assert.equal(state.state, "unavailable");
  }
  const refreshedResult = { ...result, refreshRevision: 1 };
  assert.equal(pageReadiness(refreshedResult, refreshedRequest, { loading: true }).ready, false);
  assert.equal(
    pageReadiness(refreshedResult, refreshedRequest, { loading: true }).snapshotExportReady,
    false,
  );
  assert.equal(pageReadiness(refreshedResult, refreshedRequest).ready, true);
  assert.equal(pageReadiness(refreshedResult, refreshedRequest).snapshotExportReady, true);
});

test("FY Snapshot rejects a matching retained summary after failure or Stop and recovers after retry", () => {
  for (const error of ["Dashboard summary request failed.", "Calculation stopped."]) {
    assert.equal(pageReadiness(result, request, { error }).snapshotExportReady, false);
  }
  const retry = { ...request, refreshRevision: 1 };
  assert.equal(pageReadiness(result, retry).snapshotExportReady, false);
  const retriedResult = { ...result, refreshRevision: 1 };
  assert.equal(pageReadiness(retriedResult, retry).snapshotExportReady, true);
  assert.equal(
    pageReadiness(retriedResult, { ...retry, refreshRevision: 2 }).snapshotExportReady,
    false,
  );
});

test("FY Snapshot requires its summary and accepts successful zero-result summaries", () => {
  assert.equal(pageReadiness(undefined).snapshotExportReady, false);
  assert.equal(pageReadiness({ ...result, summary: {} }).snapshotExportReady, false);
  const emptyResult = {
    ...result,
    summary: {
      finance1Summary: {
        activityCountsForFileScope: {
          supplyOrdersPlacedInSelectedFy: 0,
          liveSupplyOrdersPlacedInSelectedFy: 0,
          filesClosedInSelectedFy: 0,
        },
        activityCountsForFileScopeByInitiationYear: [],
      },
    },
  };
  assert.equal(pageReadiness(emptyResult).snapshotExportReady, true);
});
