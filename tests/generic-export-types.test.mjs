import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import ts from "typescript";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { exportsRouter } = await import("../backend/src/routes/exports.ts");
const handler = exportsRouter.stack.find((layer) => layer.route?.path === "/table").route.stack[0]
  .handle;

function invoke(body) {
  return new Promise((resolve) =>
    handler(
      { authUser: { id: "admin", role: "admin" }, body: JSON.parse(JSON.stringify(body)) },
      {
        setHeader() {},
        send(buffer) {
          resolve({ buffer });
        },
      },
      (error) => resolve({ error }),
    ),
  );
}

function zipEntry(buffer, entryName) {
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (name === entryName)
      return inflateRawSync(buffer.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  assert.fail(`Missing ZIP entry ${entryName}`);
}

function cell(sheet, reference) {
  const match = sheet.match(new RegExp(`<c r="${reference}"[^>]*>[\\s\\S]*?</c>`));
  assert.ok(match, `Missing cell ${reference}`);
  return match[0];
}

const table = {
  headers: ["Unique Code", "Cases", "Value (Lakhs)", "Date", "Timestamp", "Notes"],
  numericColumns: [2],
  dateColumns: [3],
  dateTimeColumns: [4],
  emphasizedColumns: [2],
  columnWidths: [15, 12, 18, 20, 24, 30],
  rows: [
    [
      "002620007",
      2,
      "1,00,000.25",
      "2026-10-21",
      new Date("2026-10-21T12:34:56.000Z"),
      "=SUM(A1:A2)",
    ],
    ["10", 0, "0", "21-10-2026", "2026-10-21T18:04:56+05:30", "Text"],
    ["2", -2.5, "", "", "", ""],
    ["Total", 10, "-", "2026-02-30", "2026-02-30T12:00:00Z", "Not available"],
  ],
};

test("generic endpoint preserves native numbers, typed amounts/dates, identifiers, and blanks", async () => {
  const result = await invoke({ format: "excel", title: "Typed export", tables: [table] });
  assert.equal(result.error, undefined);
  const sheet = zipEntry(result.buffer, "xl/worksheets/sheet1.xml");
  assert.match(cell(sheet, "A4"), /t="inlineStr".*>002620007<\/t>/);
  assert.match(cell(sheet, "A5"), /t="inlineStr".*>10<\/t>/);
  for (const [reference, number] of [
    ["B4", 2],
    ["B5", 0],
    ["B6", -2.5],
    ["B7", 10],
    ["C4", 100000.25],
    ["C5", 0],
  ]) {
    assert.ok(cell(sheet, reference).includes(`<v>${number}</v>`));
    assert.doesNotMatch(cell(sheet, reference), /inlineStr/);
  }
  assert.match(cell(sheet, "C4"), /s="8"/); // Emphasis metadata survives too.
  assert.match(cell(sheet, "D4"), /s="9"><v>46316<\/v>/);
  assert.match(cell(sheet, "D5"), /s="9"><v>46316<\/v>/);
  for (const ref of ["E4", "E5"])
    assert.match(cell(sheet, ref), /s="10"><v>46316\.524259259255<\/v>/);
  for (const ref of ["C6", "D6", "E6", "C7", "D7", "E7"])
    assert.match(cell(sheet, ref), /inlineStr/);
  assert.match(cell(sheet, "F4"), /inlineStr/);
  assert.doesNotMatch(cell(sheet, "F4"), /<f>/);
  assert.match(sheet, /width="18" customWidth="1"/);
});

test("metadata and native numbers survive multiple tables and additional worksheets", async () => {
  const result = await invoke({
    format: "excel",
    title: "Tables and sheets",
    tables: [table, table],
    sheets: [{ name: "Details", tables: [table] }],
  });
  assert.equal(result.error, undefined);
  const sheet = zipEntry(result.buffer, "xl/worksheets/sheet1.xml");
  assert.match(cell(sheet, "B10"), /<v>2<\/v>/);
  assert.match(cell(sheet, "D10"), /s="9"><v>46316<\/v>/);
  const details = zipEntry(result.buffer, "xl/worksheets/sheet3.xml");
  assert.match(cell(details, "B2"), /<v>2<\/v>/);
  assert.match(cell(details, "C2"), /<v>100000.25<\/v>/);
  assert.match(cell(details, "D2"), /s="9"><v>46316<\/v>/);
  assert.match(cell(details, "E2"), /s="10"><v>46316\.524259259255<\/v>/);
});

test("PDF export still renders mixed numeric and text cells", async () => {
  const result = await invoke({ format: "pdf", title: "Typed PDF", tables: [table] });
  assert.equal(result.error, undefined);
  const pdf = result.buffer.toString("utf8");
  assert.ok(pdf.startsWith("%PDF"));
  assert.ok(pdf.includes("(2)") && pdf.includes("(10)"));
  assert.ok(pdf.includes("002620007") && pdf.includes("1,00,000.25"));
});

test("generic endpoint validates numeric/date column indexes for every worksheet", async () => {
  for (const key of ["numericColumns", "dateColumns", "dateTimeColumns"]) {
    for (const invalid of [[-1], [6], [1.5], "1"]) {
      for (const extraSheet of [false, true]) {
        const broken = { ...table, [key]: invalid };
        const result = await invoke({
          format: "excel",
          title: "Invalid metadata",
          tables: [extraSheet ? table : broken],
          ...(extraSheet ? { sheets: [{ name: "Details", tables: [broken] }] } : {}),
        });
        assert.equal(result.error?.status, 400);
        assert.ok(result.error.message.includes(key));
      }
    }
  }
});

test("frontend JSON transport preserves typed cells and metadata on primary and additional sheets", async () => {
  const source = fs.readFileSync(new URL("../src/lib/export-download.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("export-download.ts", source, ts.ScriptTarget.Latest, true);
  const selected = new Set([
    "downloadBackendExport",
    "normalizeExportTable",
    "normalizeExportPlot",
    "getExportFileName",
  ]);
  let wirePayload;
  const env = vm.createContext({
    Date,
    exports: {},
    API_BASE_URL: "http://localhost",
    fetch: async (_url, request) => {
      wirePayload = JSON.parse(request.body);
      return {};
    },
    downloadExportResponse: async () => {},
    showAppAlert: (message) => assert.fail(message),
  });
  const code = ast.statements
    .filter((node) => ts.isFunctionDeclaration(node) && selected.has(node.name?.text))
    .map((node) => node.getText(ast))
    .join("\n");
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    env,
  );
  const input = { ...table, dateTimeColumns: undefined };
  await env.downloadBackendExport({
    format: "excel",
    title: "Transport",
    tables: [input],
    sheets: [{ name: "Details", tables: [input] }],
  });
  for (const result of [wirePayload.tables[0], wirePayload.sheets[0].tables[0]]) {
    assert.equal(result.rows[0][1], 2);
    assert.equal(result.rows[0][4], "2026-10-21T12:34:56.000Z");
    assert.deepEqual(result.numericColumns, [2]);
    assert.deepEqual(result.dateColumns, [3]);
    assert.deepEqual(result.dateTimeColumns, [4]);
    assert.deepEqual(result.emphasizedColumns, [2]);
    assert.deepEqual(result.columnWidths, table.columnWidths);
  }
  assert.equal(input.dateTimeColumns, undefined); // Do not mutate the caller's metadata.
  const result = await invoke(wirePayload);
  assert.equal(result.error, undefined);
  const sheet = zipEntry(result.buffer, "xl/worksheets/sheet1.xml");
  assert.match(cell(sheet, "B4"), /<v>2<\/v>/);
  assert.match(cell(sheet, "E4"), /s="10"><v>46316\.524259259255<\/v>/);
});
