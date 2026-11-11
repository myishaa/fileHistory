import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import React from "react";
import { getSnapshotSummary } from "../src/lib/snapshot-summary-state.ts";
import { dashboardHarness, descendants } from "./helpers/dashboard-review-harness.mjs";

const { env: functions, payload } = await dashboardHarness();
const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.body?.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => declaration.name.getText(ast) === "snapshotActions",
        ),
    ),
);
const declaration = (name) =>
  component.body.statements
    .find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) => item.name.getText(ast) === name),
    )
    .getText(ast);

const settings = { selectedYear: "__all_active_files__", financialYear: "2026-27" };
const summary = { dashboardFileCount: 2, dashboardSupplyOrderCount: 3 };

function render(overrides = {}) {
  const env = {
    ...functions,
    URLSearchParams,
    getSnapshotSummary,
    dashboardSummaryQueryVersion: "11",
    activeDashboardTab: "snapshot",
    activeDivision: "all",
    settings,
    isNoticeBoardFyActivity: false,
    includeArchivedYears: true,
    includeAllCancelledSupplyOrderFilesForView: true,
    activeFileYear: "all",
    fileInitiationDateQueryParams: {},
    activeFileCategoriesParam: undefined,
    finance1Year: "2026-27",
    finance1InitiationRange: {},
    selectedLiveMilestones: undefined,
    activeUser: { id: "account-a" },
    dashboardCalculationNonce: 0,
    dashboardSummaryLoading: false,
    dashboardSummaryError: undefined,
    dashboardSummaryState: undefined,
    snapshotResultView: "table",
    setSnapshotResultView() {},
    snapshotExportRows: [{ section: "TCEC", metric: "TCEC", value: 2 }],
    snapshotExportPlots: [],
    dashboardExportDescription: "Current Snapshot scope",
    ...overrides,
  };
  const code =
    [
      "dashboardSummaryQuery",
      "snapshotSummary",
      "snapshotReady",
      "snapshotExportDescription",
      "snapshotActions",
    ]
      .map(declaration)
      .join("\n") +
    "\nglobalThis.review = { query: dashboardSummaryQuery, summary: snapshotSummary, ready: snapshotReady, actions: snapshotActions };";
  vm.createContext(env);
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
    env,
  );
  return env.review;
}

const request = {
  query: render().query,
  userId: "account-a",
  refreshRevision: 0,
};
const result = { ...request, summary };
const exportButtons = (view) =>
  descendants(view.actions).filter(
    (node) => node.type === "button" && /^Export Snapshot/.test(node.props["aria-label"] ?? ""),
  );

test("Snapshot waits for a matching backend result, including a valid empty result", () => {
  assert.equal(getSnapshotSummary(undefined, request, { loading: false }), undefined);
  assert.equal(getSnapshotSummary(result, request, { loading: false }), summary);
  const empty = { dashboardFileCount: 0, dashboardSupplyOrderCount: 0 };
  assert.equal(
    getSnapshotSummary({ ...result, summary: empty }, request, { loading: false }),
    empty,
  );
});

test("scope changes immediately invalidate the result before the request effect starts", () => {
  assert.equal(render({ dashboardSummaryState: result }).ready, true);
  for (const scope of [
    { includeArchivedYears: false },
    { settings: { ...settings, selectedYear: "2025-26" } },
    { activeDivision: "ACC" },
    { activeFileYear: "2025-26" },
    { activeFileCategoriesParam: "goodsServices" },
    { fileInitiationDateQueryParams: { fileInitiationFrom: "2026-05-01" } },
  ]) {
    const view = render({ dashboardSummaryState: result, ...scope });
    assert.notEqual(view.query, result.query);
    assert.equal(view.ready, false);
    assert.ok(exportButtons(view).every((button) => button.props.disabled));
  }
});

test("same-scope Refresh and account switches cannot reuse a previous result", () => {
  for (const change of [{ dashboardCalculationNonce: 1 }, { activeUser: { id: "account-b" } }]) {
    const view = render({ dashboardSummaryState: result, ...change });
    assert.equal(view.query, result.query);
    assert.equal(view.ready, false);
    assert.ok(exportButtons(view).every((button) => button.props.disabled));
  }
});

test("loading, failure and Stop keep exports disabled and hide fallback totals and links", () => {
  for (const state of [
    {},
    { dashboardSummaryState: result, dashboardSummaryLoading: true },
    { dashboardSummaryState: result, dashboardSummaryError: "API failed" },
    {
      dashboardSummaryState: result,
      dashboardSummaryError: "Calculation stopped. Click Refresh to try again.",
    },
  ]) {
    const view = render(state);
    assert.equal(view.ready, false);
    const buttons = exportButtons(view);
    assert.equal(buttons.length, 2);
    const previousExport = payload();
    buttons.forEach((button) => {
      assert.equal(button.props.disabled, true);
      button.props.onClick();
    });
    assert.equal(payload(), previousExport);
    assert.equal(
      descendants(view.actions).some((node) => node.type === functions.DashboardScopeSummaryCards),
      false,
    );
    const content = functions.SnapshotResults({
      ready: view.ready,
      error: state.dashboardSummaryError,
      actions: view.actions,
      children: React.createElement("a", { href: "/search" }, "Fallback count 99"),
    });
    const nodes = descendants(content);
    assert.equal(
      nodes.some((node) => node.type === "a"),
      false,
    );
    assert.ok(
      nodes.some((node) => node.props?.role === (state.dashboardSummaryError ? "alert" : "status")),
    );
  }
});

test("matching results restore the selected view, authoritative totals, and both exports", () => {
  const view = render({ dashboardSummaryState: result });
  assert.equal(view.summary, summary);
  assert.equal(view.ready, true);
  const totals = descendants(view.actions).find(
    (node) => node.type === functions.DashboardScopeSummaryCards,
  );
  assert.equal(totals.props.totalFiles, 2);
  assert.equal(totals.props.totalSupplyOrders, 3);
  const content = functions.SnapshotResults({
    ready: view.ready,
    actions: view.actions,
    children: React.createElement("table", { id: "backend-results" }),
  });
  assert.ok(descendants(content).some((node) => node.type === "table"));
  for (const button of exportButtons(view)) {
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(payload().title, "Snapshot");
    assert.equal(payload().tables[0].rows[0][1], 2);
    assert.ok(payload().description.includes("Active files from archived years: Checked"));
    assert.ok(!payload().description.includes("Files with all S.O.s cancelled:"));
  }
});

test("a response from an earlier archive scope stays unusable after a later response", () => {
  const current = render({ includeArchivedYears: false });
  const latest = {
    ...result,
    query: current.query,
    summary: { ...summary, dashboardFileCount: 1 },
  };
  assert.equal(render({ includeArchivedYears: false, dashboardSummaryState: latest }).ready, true);
  assert.equal(render({ includeArchivedYears: false, dashboardSummaryState: result }).ready, false);
});
