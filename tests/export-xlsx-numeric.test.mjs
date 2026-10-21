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
