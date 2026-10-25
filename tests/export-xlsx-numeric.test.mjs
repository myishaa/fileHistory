import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { renderXlsxDocument } from "../backend/src/utils/export-xlsx.ts";

function readZipEntry(buffer, entryName) {
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + fileNameLength);
    const dataStart = nameStart + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (name === entryName) return inflateRawSync(compressed).toString("utf8");
    offset = dataStart + compressedSize;
  }
  throw new Error(`ZIP entry not found: ${entryName}`);
}

test("numeric export columns are written as Excel numbers", () => {
  const workbook = renderXlsxDocument({
    title: "Quick Entry",
    tables: [
      {
        headers: ["File", "Capital value"],
        rows: [["File A", "120000"]],
        numericColumns: [1],
      },
    ],
  });
  const sheet = readZipEntry(workbook, "xl/worksheets/sheet1.xml");

  assert.match(sheet, /<c r="B4" s="\d+"><v>120000<\/v><\/c>/);
  assert.doesNotMatch(sheet, /<c r="B4"[^>]*t="inlineStr"/);
});

test("date and date-time export columns are Excel serials and missing values stay blank", () => {
  const workbook = renderXlsxDocument({
    title: "Quick Entry",
    tables: [
      {
        headers: ["File", "Received date", "Status date and time", "Amount"],
        rows: [["File A", "2026-10-21", "2026-10-21T12:34:56", ""]],
        dateColumns: [1],
        dateTimeColumns: [2],
        numericColumns: [3],
      },
    ],
  });
  const sheet = readZipEntry(workbook, "xl/worksheets/sheet1.xml");
  const styles = readZipEntry(workbook, "xl/styles.xml");

  assert.match(sheet, /<c r="B4" s="9"><v>46316<\/v><\/c>/);
  assert.match(sheet, /<c r="C4" s="10"><v>46316\.524259259255<\/v><\/c>/);
  assert.match(sheet, /<c r="D4"[^>]*t="inlineStr"/);
  assert.doesNotMatch(sheet, /<c r="D4"[^>]*><v>0<\/v>/);
  assert.match(styles, /formatCode="dd-mmm-yyyy"/);
  assert.match(styles, /formatCode="dd-mmm-yyyy hh:mm:ss"/);
});

test("additional export sheets are registered and rendered in the workbook", () => {
  const workbook = renderXlsxDocument({
    title: "Quick Entry",
    tables: [{ headers: ["File"], rows: [["File A"]] }],
    sheets: [
      {
        name: "Scope",
        tables: [
          {
            title: "Export scope",
            headers: ["Export detail", "Value"],
            rows: [["Export mode", "FY Based"]],
          },
        ],
      },
    ],
  });
  const workbookXml = readZipEntry(workbook, "xl/workbook.xml");
  const relationships = readZipEntry(workbook, "xl/_rels/workbook.xml.rels");
  const contentTypes = readZipEntry(workbook, "[Content_Types].xml");
  const scopeSheet = readZipEntry(workbook, "xl/worksheets/sheet3.xml");

  assert.match(workbookXml, /<sheet name="Scope" sheetId="3" r:id="rId3"\/>/);
  assert.match(relationships, /Id="rId3"[^>]+Target="worksheets\/sheet3\.xml"/);
  assert.match(relationships, /Id="rId4"[^>]+Target="styles\.xml"/);
  assert.match(contentTypes, /PartName="\/xl\/worksheets\/sheet3\.xml"/);
  assert.match(scopeSheet, /Export scope/);
  assert.match(scopeSheet, /Export mode/);
  assert.match(scopeSheet, /FY Based/);
});
