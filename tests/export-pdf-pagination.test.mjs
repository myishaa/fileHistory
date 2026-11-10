import assert from "node:assert/strict";
import test from "node:test";
import { renderPdfDocument } from "../backend/src/utils/export-files.ts";

function render(document) {
  const pdf = renderPdfDocument(document).toString("utf8");
  assert.ok(pdf.startsWith("%PDF"));
  const pages = [...pdf.matchAll(/\nstream\n([\s\S]*?)\nendstream/g)].map((match) => match[1]);
  assert.ok(pages.length);
  for (const page of pages) {
    // Check real PDF drawing coordinates, including row borders and text.
    for (const match of page.matchAll(/([\d.-]+) ([\d.-]+) Td\n\(([^\n]*)\) Tj/g)) {
      const [, , y, text] = match;
      if (/^\d+ of \d+$/.test(text)) continue; // Page-number footer.
      assert.ok(
        Number(y) >= 36 && Number(y) <= 577,
        `Text outside content area at y=${y}: ${text.slice(0, 80)}`,
      );
    }
    for (const match of page.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re [Sf]/g)) {
      assert.ok(Number(match[2]) >= 36, `Row below bottom margin: ${match[0]}`);
      assert.ok(Number(match[2]) + Number(match[4]) <= 559.01, `Row above top margin: ${match[0]}`);
    }
  }
  return pages;
}

function history(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(4, "0")}`,
  ).join(" ");
}

function assertEveryTokenOnce(pages, prefix, count) {
  const tokens = pages.join("\n").match(new RegExp(`${prefix}\\d{4}`, "g")) ?? [];
  assert.deepEqual(tokens, history(prefix, count).split(" "));
}

test("oversized PDF rows continue across pages with headers, aligned cells, and every history entry intact", () => {
  const pages = render({
    title: "File history",
    tables: [
      {
        headers: ["File", "History", "Remarks"],
        columnWidths: [70, 350, 350],
        emphasizedColumns: [1],
        rows: [
          ["FILE-1", history("EVENT", 1800), history("REMARK", 1100)],
          ["FILE-2", "Following row", "Final note"],
        ],
      },
    ],
  });
  assert.ok(pages.length > 3);
  assertEveryTokenOnce(pages, "EVENT", 1800);
  assertEveryTokenOnce(pages, "REMARK", 1100);
  for (const page of pages) {
    assert.ok(
      page.includes("(File) Tj") && page.includes("(History) Tj") && page.includes("(Remarks) Tj"),
    );
    assert.ok(page.includes("0.93 0.96 0.99 rg")); // Emphasis on every fragment.
  }
  assert.equal(pages.filter((page) => page.includes("(FILE-1) Tj")).length, 1);
  assert.ok(pages.at(-1).includes("(FILE-2) Tj") && pages.at(-1).includes("(Following row) Tj"));
});

test("a row that fits on a fresh page stays together instead of splitting at the previous page bottom", () => {
  const pages = render({
    title: "Ordinary pagination",
    tables: [
      {
        headers: ["File", "History"],
        columnWidths: [100, 670],
        rows: [
          ...Array.from({ length: 15 }, (_, index) => [`File ${index}`, "Short history"]),
          ["NORMAL-ROW", history("NORMAL", 220)],
        ],
      },
    ],
  });
  assert.equal(pages.length, 2);
  assert.ok(!pages[0].includes("NORMAL0000"));
  assertEveryTokenOnce(pages, "NORMAL", 220);
  assert.ok(pages[1].includes("NORMAL0000") && pages[1].includes("NORMAL0219"));
  assert.ok(pages[1].includes("(File) Tj") && pages[1].includes("(History) Tj"));
});

test("an unbroken oversized cell is split without losing any characters", () => {
  const content = "X".repeat(14000);
  const pages = render({
    title: "Long cell",
    tables: [{ headers: ["History"], rows: [[content]] }],
  });
  assert.ok(pages.length > 1);
  const chunks = pages.flatMap((page) =>
    [...page.matchAll(/\((X+)\) Tj/g)].map((match) => match[1]),
  );
  assert.equal(chunks.join(""), content);
  for (const page of pages) assert.ok(page.includes("(History) Tj"));
});

test("oversized export-detail and notes rows also paginate with their repeated headers", () => {
  for (const detail of [true, false]) {
    const pages = render({
      title: "Scope details",
      description: `${detail ? "Filter: " : ""}${history("SCOPE", 2400)}`,
      tables: [{ headers: ["Result"], rows: [["Complete"]] }],
    });
    assert.ok(pages.length > 2);
    assertEveryTokenOnce(pages, "SCOPE", 2400);
    const contentPages = pages.filter((page) => /SCOPE\d{4}/.test(page));
    for (const page of contentPages) {
      assert.ok(page.includes(detail ? "(Export detail) Tj" : "(Notes) Tj"));
    }
  }
});

test("empty tables and wrapped headers retain their content during pagination", () => {
  const header = "A descriptive history column heading";
  const pages = render({
    title: "Wrapped headers",
    tables: [
      { title: "Empty", headers: ["File", "History"], rows: [] },
      { headers: [header, "File"], columnWidths: [180, 590], rows: [[history("WRAP", 900), "A"]] },
    ],
  });
  assert.ok(pages.join("\n").includes("No rows found."));
  assertEveryTokenOnce(pages, "WRAP", 900);
  for (const page of pages.filter((page) => /WRAP\d{4}/.test(page))) {
    assert.ok(page.includes("(A descriptive history column) Tj"));
    assert.ok(page.includes("(heading) Tj"));
  }
});
