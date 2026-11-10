import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/routes/reports.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("reports.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "MonthlyOperationalReport",
);
assert.ok(component, "Monthly Reports component exists");

const stub = () => null;
const env = vm.createContext({
  React,
  useState: (initial) => [initial, stub],
  getMonthlyReportTotalCells: () => [],
  ReportDescription: stub,
  TableChartToggle: stub,
  FileText: stub,
  FileSpreadsheet: stub,
  SnapshotChartRenderer: () => null,
  MonthlyCountCalendar: stub,
});
vm.runInContext(
  ts.transpileModule(component.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText,
  env,
);

function descendants(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(descendants);
  return [element, ...descendants(element.props?.children)];
}

for (const [name, columns, rows] of [
  [
    "monthly count",
    [{ key: "month", label: "Month" }, { key: "files", label: "Files" }],
    [{ month: "Apr", files: 3 }],
  ],
  [
    "BG type breakdown",
    [
      { key: "month", label: "Month" },
      { key: "psb", label: "PSB" },
      { key: "pwb", label: "PWB" },
      { key: "psbPwb", label: "PSB+PWB" },
    ],
    [{ month: "Apr", psb: 1, pwb: 2, psbPwb: 3 }],
  ],
]) {
  for (const view of ["bar", "column"]) {
    test(`${name} ${view} view sends its orientation to PDF and Excel`, () => {
      env.useState = (initial) => [initial === "table" ? view : initial, stub];
      const received = [];
      const nodes = descendants(
        env.MonthlyOperationalReport({
          reportMode: "monthly",
          title: name,
          description: "Monthly results",
          columns,
          rows,
          onOpenSearch: stub,
          onPdf: (plot) => received.push(["PDF", plot]),
          onExcel: (plot) => received.push(["Excel", plot]),
        }),
      );
      assert.equal(
        nodes.find((node) => node.type === env.SnapshotChartRenderer)?.props.kind,
        view,
      );
      for (const format of ["PDF", "Excel"]) {
        const button = nodes.find(
          (node) => node.type === "button" && node.props.children?.at(-1) === format,
        );
        assert.ok(button, `${format} button exists`);
        button.props.onClick();
      }
      assert.deepEqual(received.map(([format]) => format), ["PDF", "Excel"]);
      for (const [, plot] of received) {
        assert.equal(plot.kind, "bar");
        assert.equal(plot.orientation, view === "bar" ? "horizontal" : "vertical");
        assert.equal(plot.stackedBars, name === "BG type breakdown" ? true : undefined);
      }
    });
  }
}
