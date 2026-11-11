import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import ts from "typescript";
import { renderExcelDocument, renderPdfDocument } from "../backend/src/utils/export-files.ts";
import { dashboardHarness } from "./helpers/dashboard-review-harness.mjs";

const { env, payload } = await dashboardHarness();
const summary = {
  ...env.createEmptyFinance1Summary("2025-26"),
  asOfDate: "2026-11-09",
  fileTypeDistribution: [
    { fileType: "AMC", files: 12, filesWithSoLive: 10, active: 9, closed: 2, cancelled: 1 },
    { fileType: "MPC", files: 5, filesWithSoLive: 4, active: 3, closed: 1, cancelled: 1 },
  ],
  firmTypeDistribution: [
    { firmType: "MSE", supplyOrders: 2, capital: 625000, revenue: 0, total: 625000 },
    { firmType: "DPSU", supplyOrders: 1, capital: 0, revenue: 375000, total: 375000 },
  ],
};
const positionRows = [
  { position: "Allocated", capital: 1000000, revenue: 2000000 },
  { position: "Committed", capital: 625000, revenue: 375000 },
];
const options = {
  fileTypeView: "bar",
  fileTypeMetric: "closed",
  firmTypeView: "pie",
  periodLabel: "FY 2025-26",
  includeDistributions: true,
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const dateSource = fs.readFileSync(
  new URL("../src/components/date-input.tsx", import.meta.url),
  "utf8",
);
const dateAst = ts.createSourceFile(
  "date-input.tsx",
  dateSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const dateFormatter = dateAst.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "formatIsoDateForDisplay",
);
vm.runInContext(
  ts.transpileModule(dateFormatter.getText(dateAst).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText,
  env,
);
const declarations = new Map();
const toolbarActions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "button") {
    const attrs = node.attributes.properties;
    const label = attrs.find((attr) => attr.name?.getText(ast) === "aria-label")?.initializer;
    const action = attrs.find((attr) => attr.name?.getText(ast) === "onClick")?.initializer
      ?.expression;
    if (label && ts.isStringLiteral(label) && action) toolbarActions.set(label.text, action);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function exportFromToolbar(format, overrides = {}) {
  Object.assign(env, {
    finance1Summary: summary,
    finance1PositionChartRows: positionRows,
    finance1AsOfDate: summary.asOfDate,
    finance1PeriodLabel: "FY 2025-26",
    finance1SnapshotExportTitle: "FY Snapshot 2025-26",
    finance1ExportReady: true,
    snapshotSummary: { dashboardFileCount: 7, dashboardSupplyOrderCount: 11 },
    // Cohort and fallback totals must not replace the header's authoritative totals.
    dashboardFileCount: 999,
    dashboardSupplyOrderCount: 888,
    dashboardExportDescription: "Global Filter: 2025-26\nDivision: ACC",
    includeArchivedYears: true,
    finance1FileTypeView: "bar",
    finance1FileTypeMetric: "closed",
    finance1FirmTypeView: "pie",
    isNoticeBoardFinanceSnapshot: false,
    ...overrides,
  });
  const scopeTable = declarations.get("finance1SnapshotExportTables").initializer.elements[0];
  const action = toolbarActions.get(`Export FY Snapshot ${format === "pdf" ? "PDF" : "Excel"}`);
  assert.ok(action);
  const code = `(() => {
    const ${declarations.get("finance1SnapshotExportDescription").getText(ast)};
    const ${declarations.get("finance1SnapshotExportPlots").getText(ast)};
    const finance1SnapshotExportTables = [${scopeTable.getText(ast)},
      { title: "Financial Position", headers: ["Measure", "Value"], rows: [["Committed", "10"]] }];
    (${action.getText(ast)})();
  })()`;
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    env,
  );
  return copy(payload());
}

function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18),
      nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, inflateRawSync(buffer.subarray(start, start + size)).toString("utf8"));
    offset = start + size;
  }
  return entries;
}

for (const format of ["pdf", "excel"]) {
  test(`${format} toolbar export includes header totals, archive scope, and displayed charts`, () => {
    const descriptions = new Set();
    for (const archived of [true, false]) {
      const doc = exportFromToolbar(format, {
        includeArchivedYears: archived,
      });
      assert.equal(doc.format, format);
      assert.match(doc.description, /As on date: 09-11-2026/);
      assert.match(doc.description, /Global Filter: 2025-26\nDivision: ACC/);
      assert.ok(
        doc.description.includes(
          `Active files from archived years: ${archived ? "Checked" : "Unchecked"}`,
        ),
      );
      assert.match(
        doc.description,
        /Cancelled column counts each retained file once.*fully S\.O\.-cancelled files/,
      );
      assert.match(
        doc.description,
        /those files remain excluded from the ordinary Snapshot header, position, activity, and financial totals/,
      );
      assert.ok(!doc.description.includes("Files with all S.O.s cancelled:"));
      descriptions.add(doc.description);
      assert.deepEqual(doc.tables[0], {
        title: "Scope summary",
        headers: ["Measure", "Count"],
        rows: [
          ["Files", 7],
          ["S.O.", 11],
        ],
      });
      assert.equal(doc.tables[1].title, "Financial Position");
      assert.equal(doc.plots.length, 4);
      assert.deepEqual(
        doc.plots.map((plot) => plot.kind),
        ["bar", "bar", "pie", "pie"],
      );
      assert.equal(doc.plots[0].orientation, "vertical");
      assert.equal(doc.plots[1].orientation, "horizontal");
      assert.deepEqual(doc.plots[1].series[0].values, [2, 1]);
      assert.deepEqual(doc.plots[2].series[0].values, [6.25, 3.75]);
      assert.deepEqual(doc.plots[3].series[0].values, [2, 1]);

      const document = doc;
      if (format === "excel") {
        const entries = zipEntries(renderExcelDocument(document));
        const sheet = entries.get("xl/worksheets/sheet1.xml");
        assert.ok(sheet.includes("Scope summary") && sheet.includes("S.O."));
        assert.ok(sheet.includes(archived ? "Checked" : "Unchecked"));
        const charts = [...entries]
          .filter(([name]) => /^xl\/charts\/chart\d+\.xml$/.test(name))
          .map(([, xml]) => xml);
        assert.equal(charts.filter((xml) => xml.includes("<c:pieChart>")).length, 2);
        assert.ok(charts.some((xml) => xml.includes('<c:barDir val="bar"/>')));
        assert.ok(charts.some((xml) => xml.includes('<c:barDir val="col"/>')));
      } else {
        const pdf = renderPdfDocument(document).toString("utf8");
        assert.ok(pdf.startsWith("%PDF"));
        assert.ok(pdf.includes("Scope summary") && pdf.includes("S.O."));
        assert.ok(pdf.includes("MSE: 6.25") && pdf.includes("DPSU: 3.75"));
        assert.ok(pdf.includes("MSE: 2") && pdf.includes("DPSU: 1"));
      }
    }
    assert.equal(descriptions.size, 2);
  });
}

test("File Type export follows every selected metric and bar orientation", () => {
  const values = { files: 12, withSo: 10, active: 9, closed: 2, cancelled: 1 };
  for (const [metric, value] of Object.entries(values))
    for (const view of ["bar", "column"]) {
      const plots = env.getFinance1SnapshotExportPlots(summary, positionRows, {
        ...options,
        fileTypeMetric: metric,
        fileTypeView: view,
        firmTypeView: "table",
      });
      assert.equal(plots.length, 2);
      assert.equal(plots[1].series[0].values[0], value);
      assert.equal(plots[1].measure, env.getFinance1FileTypeChartMetric(metric).label);
      assert.equal(plots[1].orientation, view === "bar" ? "horizontal" : "vertical");
    }
});

test("Firm Type export follows the selected table, bar, column, or pie view", () => {
  for (const view of ["table", "bar", "column", "pie"]) {
    const plots = env.getFinance1SnapshotExportPlots(summary, positionRows, {
      ...options,
      fileTypeView: "table",
      firmTypeView: view,
    });
    assert.equal(plots.length, view === "table" ? 1 : 3);
    if (view === "table") continue;
    assert.equal(plots[1].kind, view === "pie" ? "pie" : "bar");
    assert.equal(
      plots[1].orientation,
      view === "pie" ? undefined : view === "bar" ? "horizontal" : "vertical",
    );
    assert.equal(plots[1].unit, "Lakhs");
    assert.deepEqual(copy(plots[1].series[0].values), [6.25, 3.75]);
    assert.deepEqual(copy(plots[2].series[0].values), [2, 1]);
  }
});

test("comparison data uses Lakhs once; table modes and embedded view omit hidden distribution charts", () => {
  for (const overrides of [
    { fileTypeView: "table", firmTypeView: "table" },
    { includeDistributions: false },
  ]) {
    const plots = env.getFinance1SnapshotExportPlots(summary, positionRows, {
      ...options,
      ...overrides,
    });
    assert.equal(plots.length, 1);
    assert.deepEqual(copy(plots[0].series), [
      { name: "Capital", values: [10, 6.25] },
      { name: "Revenue", values: [20, 3.75] },
    ]);
  }
});

test("scope exports retain explicit zero totals and plots wait for matching ready data", () => {
  const doc = exportFromToolbar("excel", {
    snapshotSummary: { dashboardFileCount: 0, dashboardSupplyOrderCount: 0 },
    finance1ExportReady: false,
  });
  assert.deepEqual(doc.tables[0].rows, [
    ["Files", 0],
    ["S.O.", 0],
  ]);
  assert.deepEqual(doc.plots, []);
});
