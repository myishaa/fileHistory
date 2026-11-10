import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import ts from "typescript";
import { renderExcelDocument, renderPdfDocument } from "../backend/src/utils/export-files.ts";
import { formatThousandsAndLakhs, getInrAmount } from "../src/lib/money.ts";

const source = fs.readFileSync(new URL("../src/routes/reports.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "reports.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions = new Set([
  "getSoPaymentMatrixExportFieldValue",
  "getSoPaymentMatrixFieldValue",
  "getSupplyOrderRef",
  "exportSoPaymentMatrixReport",
  "formatSoPaymentMatrixAmount",
  "getReportExportDescription",
  "flattenHelperText",
  "splitHelperText",
  "protectHelperAbbreviations",
  "restoreHelperAbbreviations",
  "formatPaymentMeasureLabel",
  "formatSoPaymentMatrixMonthLabel",
  "parseLocalMonth",
  "getSoPaymentMatrixRowTotal",
  "getSoPaymentMatrixMonthAmount",
]);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node);
  ts.forEachChild(node, visit);
}
visit(ast);

function harness() {
  let payload;
  const env = vm.createContext({
    getInrAmount,
    formatThousandsAndLakhs,
    downloadBackendExport: async (value) => {
      payload = value;
    },
  });
  const code = ast.statements
    .filter((node) => ts.isFunctionDeclaration(node) && functions.has(node.name?.text))
    .map((node) => node.getText(ast))
    .join("\n");
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    env,
  );
  return { env, payload: () => JSON.parse(JSON.stringify(payload)) };
}

const columns = [
  ["fileUniqueNo", "Unique Code"],
  ["soNo", "S.O. No."],
  ["demandValue", "Demand value"],
  ["capitalValue", "Capital value"],
  ["revenueValue", "Revenue value"],
  ["soValue", "S.O. value"],
].map(([key, label]) => ({ key, label }));

function row(head, amount = "1000000", currency = "INR", exchangeRate) {
  const inr = getInrAmount(amount, { currency, exchangeRate });
  return {
    file: { uniqueCode: "2620007", [`value${head}`]: amount, currency, exchangeRate },
    order: { soNo: "SO/1000000", [`soValue${head}`]: amount },
    monthCapitalAmounts: { "2026-04": head === "Capital" ? inr : 0 },
    monthRevenueAmounts: { "2026-04": head === "Revenue" ? inr : 0 },
    monthAmounts: { "2026-04": inr },
    capitalTotal: head === "Capital" ? inr : 0,
    revenueTotal: head === "Revenue" ? inr : 0,
    total: inr,
  };
}

function exportMatrix(name, format, rows) {
  const { env, payload } = harness();
  Object.assign(env, {
    soPaymentMatrixRows: rows,
    paymentCompletedMatrixRows: rows,
    soPaymentMatrixColumns: columns,
    paymentCompletedMatrixColumns: columns,
    soPaymentMatrixMonthKeys: ["2026-04"],
    selectedReportTitle: name,
    soPaymentMatrixExportDescription: "Current scope",
  });
  vm.runInContext(
    ts.transpileModule(`const run = ${declarations.get(name).initializer.getText(ast)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    env,
  );
  env.format = format;
  vm.runInContext("run(format)", env);
  return payload();
}

function excelSheets(buffer) {
  let offset = 0;
  let sheets = "";
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      sheets += inflateRawSync(buffer.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  return sheets;
}

for (const name of ["exportSoPaymentMatrix", "exportPaymentCompletedMatrix"]) {
  for (const format of ["pdf", "excel"]) {
    test(`${name} ${format}: every monetary column uses Lakhs`, () => {
      const doc = exportMatrix(name, format, [row("Capital"), row("Revenue")]);
      assert.equal(doc.format, format);
      assert.match(doc.description, /All the values are in Lakh/);
      const [revenue, capital, total] = doc.tables;
      assert.deepEqual(capital.rows[0], [
        "2620007",
        "SO/1000000",
        "10",
        "10",
        "0",
        "10",
        "10",
        "10",
      ]);
      assert.deepEqual(revenue.rows[0], [
        "2620007",
        "SO/1000000",
        "10",
        "0",
        "10",
        "10",
        "10",
        "10",
      ]);
      assert.deepEqual(total.rows.at(-1), ["All rows total", "", "", "", "", "", "20", "20"]);
      const rendered =
        format === "pdf"
          ? renderPdfDocument(doc).toString("utf8")
          : excelSheets(renderExcelDocument(doc));
      assert.ok(rendered.includes("Demand value"));
      assert.ok(rendered.includes("S.O. value"));
      assert.ok(rendered.includes("2620007"));
      assert.ok(!rendered.includes(">1000000</t>") && !rendered.includes("(1000000)"));
      assert.ok(format === "pdf" ? rendered.includes("(10)") : rendered.includes("<v>10</v>"));
    });
  }
}

test("matrix value columns convert exchange rates once and retain fractional Lakhs", () => {
  const doc = exportMatrix("exportSoPaymentMatrix", "excel", [
    row("Capital", "12345.67", "USD", "83"),
  ]);
  assert.deepEqual(doc.tables[1].rows[0], [
    "2620007",
    "SO/1000000",
    "10.25",
    "10.25",
    "0",
    "10.25",
    "10.25",
    "10.25",
  ]);
});

test("matrix blank value columns use zero and decimal rupees are scaled consistently", () => {
  const fixture = row("Revenue", "1000000.50");
  fixture.file.valueRevenue = "";
  const doc = exportMatrix("exportPaymentCompletedMatrix", "pdf", [fixture]);
  assert.deepEqual(doc.tables[0].rows[0], [
    "2620007",
    "SO/1000000",
    "0",
    "0",
    "0",
    "10",
    "10",
    "10",
  ]);
});
