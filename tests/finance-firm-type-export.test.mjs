import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import ts from "typescript";
import { renderExcelDocument, renderPdfDocument } from "../backend/src/utils/export-files.ts";
import { dashboardHarness } from "./helpers/dashboard-review-harness.mjs";

const { env, payload } = await dashboardHarness();
const distribution = [
  { name: "MSE", count: 2, capital: 625000, revenue: 0, value: 625000, share: 62.5 },
  { name: "DPSU", count: 1, capital: 0, revenue: 375000, value: 375000, share: 37.5 },
];
const extraTable = { title: "Activity counts", headers: ["S.O. placed"], rows: [[3]] };
const copy = (value) => JSON.parse(JSON.stringify(value));

function zipEntry(buffer, key) {
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (name === key) return inflateRawSync(buffer.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  throw new Error(`Missing workbook entry: ${key}`);
}

for (const format of ["pdf", "excel"]) {
  for (const measure of ["supplyOrderValue", "actualPayment"]) {
    test(`${format} exports the displayed Firm Type columns and selected ${measure} pie`, async () => {
      await env.downloadFinanceRows(
        [],
        "FY Activity",
        distribution,
        "Selected distribution",
        format,
        "Scope",
        [extraTable],
        measure,
      );
      const result = copy(payload());
      const valueLabel = measure === "supplyOrderValue" ? "Total S.O. Value" : "Total Payment";
      assert.deepEqual(result.tables[1].headers, [
        "S.No.",
        "Firm type",
        measure === "supplyOrderValue" ? "S.O.s" : "Payment cases",
        "Capital (Lakhs)",
        "Revenue (Lakhs)",
        `${valueLabel} (Lakhs)`,
        "Share",
      ]);
      assert.deepEqual(result.tables[1].rows, [
        [1, "MSE", 2, "6.25", "0", "6.25", "62.5%"],
        [2, "DPSU", 1, "0", "3.75", "3.75", "37.5%"],
      ]);
      assert.deepEqual(result.tables[2], extraTable);
      assert.equal(result.plot.kind, "pie");
      assert.equal(result.plot.measure, valueLabel);
      assert.equal(result.plot.unit, "Lakhs");
      assert.deepEqual(result.plot.categories, ["MSE", "DPSU"]);
      assert.deepEqual(result.plot.series, [{ name: valueLabel, values: [6.25, 3.75] }]);

      // Verify the actual document renderers retain typed values and metadata.
      const document = result;
      if (format === "excel") {
        const workbook = renderExcelDocument(document);
        const chart = zipEntry(workbook, "xl/charts/chart1.xml");
        const sheet = zipEntry(workbook, "xl/worksheets/sheet1.xml");
        assert.match(chart, /<c:pieChart>/);
        assert.doesNotMatch(chart, /<c:barChart>/);
        assert.ok(chart.includes("6.25") && chart.includes("3.75"));
        assert.ok(sheet.includes("Capital (Lakhs)") && sheet.includes("Revenue (Lakhs)"));
        assert.ok(sheet.includes("62.5%") && sheet.includes("37.5%"));
      } else {
        const pdf = renderPdfDocument(document).toString("utf8");
        assert.ok(pdf.startsWith("%PDF"));
        assert.ok(pdf.includes("MSE: 6.25") && pdf.includes("DPSU: 3.75"));
        assert.ok(pdf.includes("62.5%") && pdf.includes("37.5%"));
      }
    });
  }
}

const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const toolbarActions = new Map();
function visit(node) {
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

test("Finance and FY Activity toolbar actions forward the selected payment measure and rows", () => {
  Object.assign(env, {
    financeExportRows: [],
    fyActivityExportRows: [],
    financeExportTitle: "Finance",
    fyActivityExportTitle: "FY Activity",
    fyActivityFirmTypeDistributionExportRows: distribution,
    financeFirmTypeDistributionExportRows: distribution,
    selectedFinanceFirmTypeDistributionLabel: "Selected distribution",
    dashboardExportDescription: "Scope",
    fyActivityExportDescription: "Scope\nArchived years: Checked\nAll-cancelled files: Unchecked",
    fyActivityExportTables: [extraTable],
    fyActivityExportPlots: [],
    financeFirmTypeDistributionKey: "actualPayment",
  });
  for (const label of [
    "Export Finance PDF",
    "Export Finance Excel",
    "Export FY Activity as PDF",
    "Export FY Activity as Excel",
  ]) {
    assert.ok(toolbarActions.has(label));
    const code = `(${toolbarActions.get(label).getText(ast)})()`;
    vm.runInContext(
      ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
      env,
    );
    assert.equal(payload().tables[1].headers[2], "Payment cases");
    assert.equal(payload().plot.measure, "Total Payment");
    if (label.includes("FY Activity")) assert.deepEqual(copy(payload().tables[2]), extraTable);
  }
});

test("zero and missing distributions do not invent a pie chart", async () => {
  for (const rows of [
    [],
    [{ name: "MSE", count: 0, capital: 0, revenue: 0, value: 0, share: 0 }],
  ]) {
    await env.downloadFinanceRows([], "FY Activity", rows, "S.O. value", "excel");
    assert.equal(payload().plot, undefined);
    if (rows.length)
      assert.deepEqual(copy(payload().tables[1].rows), [[1, "MSE", 0, "0", "0", "0", "0%"]]);
  }
});

test("every Firm Type category remains in the export table and pie data", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    name: `Type ${index + 1}`,
    count: 1,
    capital: 0,
    revenue: 100000,
    value: 100000,
    share: 100 / 12,
  }));
  await env.downloadFinanceRows([], "FY Activity", rows, "S.O. value", "pdf");
  assert.equal(payload().tables[1].rows.length, 12);
  assert.equal(payload().plot.categories.length, 12);
  assert.deepEqual(copy(payload().plot.series[0].values), Array(12).fill(1));
});
