type ExportTable = {
  title?: string;
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
};

type ExportDocument = {
  title: string;
  subtitle?: string;
  description?: string;
  tables: ExportTable[];
};

type ExportDescriptionRow =
  | { kind: "pair"; label: string; value: string }
  | { kind: "note"; value: string };

type ExportDescriptionSections = {
  details: Array<{ label: string; value: string }>;
  notes: string[];
};

const pdfPageWidth = 842;
const pdfPageHeight = 595;
const pdfMargin = 36;
const pdfContentWidth = pdfPageWidth - pdfMargin * 2;
const pdfFontSize = 8.5;
const pdfTitleFontSize = 18;
const pdfSubheadingFontSize = 10;
const pdfLineHeight = 11;
const pdfCellPaddingX = 4;
const pdfCellPaddingY = 4;
const pdfMinRowHeight = 19;

type PdfPage = {
  commands: string[];
  y: number;
};

type AddPdfPage = () => PdfPage;

export function getExportFileName(title: string, extension: "xls" | "pdf") {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  return `${base}.${extension}`;
}

export function renderExcelDocument(document: ExportDocument) {
  const descriptionSections = parseExportDescriptionSections(document.description);
  const generatedAt = formatGeneratedAt();
  const tables = document.tables
    .map(
      (table) => `
        ${table.title ? `<h2>${escapeHtml(table.title)}</h2>` : ""}
        <table>
          <thead>
            <tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${
              table.rows.length
                ? table.rows
                    .map(
                      (row) =>
                        `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`,
                    )
                    .join("")
                : `<tr><td colspan="${Math.max(1, table.headers.length)}">No rows found.</td></tr>`
            }
          </tbody>
        </table>
      `,
    )
    .join("");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; margin-bottom: 16px; }
          th, td { border: 1px solid #999; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          h1 { font-size: 18px; margin: 0 0 6px; }
          h2 { font-size: 14px; margin: 14px 0 6px; }
          p { margin: 0 0 10px; color: #4b5563; }
          table.export-title { border-collapse: collapse; width: 100%; margin: 0 0 6px; }
          table.export-title td { border: 0; padding: 0; }
          table.export-title .stamp { text-align: right; color: #64748b; font-size: 11px; white-space: nowrap; }
          table.description { border-collapse: collapse; margin: 0 0 12px; max-width: 900px; }
          table.description th, table.description td { border: 1px solid #cbd5e1; padding: 5px 7px; color: #374151; }
          table.description th { background: #e0f2fe; width: 180px; white-space: nowrap; }
          table.description-notes { border-collapse: collapse; margin: 0 0 12px; max-width: 900px; }
          table.description-notes td { border: 1px solid #e2e8f0; padding: 5px 7px; color: #475569; background: #f8fafc; font-style: italic; }
        </style>
      </head>
      <body>
        <table class="export-title">
          <tr>
            <td><h1>${escapeHtml(document.title)}</h1></td>
            <td class="stamp">${escapeHtml(generatedAt)}</td>
          </tr>
        </table>
        ${document.subtitle ? `<p>${escapeHtml(document.subtitle)}</p>` : ""}
        ${renderDescriptionHtml(descriptionSections)}
        ${tables}
      </body>
    </html>`;
}

export function renderPdfDocument(document: ExportDocument) {
  const pages = renderPdfPages(document);
  addPdfPageNumbers(pages);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const fontObjectId = 3;

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("PAGES_PLACEHOLDER");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((page) => {
    const pageObjectId = objects.length + 1;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidth} ${pdfPageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    const content = page.commands.join("\n");
    objects.push(
      `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
    );
  });

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body, "utf8");
}

function renderPdfPages(document: ExportDocument) {
  const pages: PdfPage[] = [];
  let page = createPdfPage();
  pages.push(page);
  const generatedAt = formatGeneratedAt();

  const addPage = () => {
    page = createPdfPage();
    pages.push(page);
    return page;
  };

  drawText(page, document.title, pdfMargin, page.y, pdfTitleFontSize);
  drawTextRight(page, generatedAt, pdfPageWidth - pdfMargin, page.y + 2, pdfSubheadingFontSize);
  page.y -= 24;
  if (document.subtitle) {
    drawText(page, document.subtitle, pdfMargin, page.y, pdfSubheadingFontSize);
    page.y -= 15;
  }
  const descriptionSections = parseExportDescriptionSections(document.description);
  if (descriptionSections.details.length) {
    page = drawDescriptionTable(page, descriptionSections.details, addPage);
  }
  if (descriptionSections.notes.length) {
    page = drawDescriptionNotes(page, descriptionSections.notes, addPage);
  }
  page.y -= descriptionSections.notes.length ? 22 : 10;

  document.tables.flatMap(getPdfTableSegments).forEach((table) => {
    const columns = normalizeColumns(table.headers.length);
    const columnWidths = getColumnWidths(table.headers, table.rows, table.columnWidths);
    const rows = table.rows.length ? table.rows : [["No rows found."]];

    const ensureSpace = (height: number) => {
      if (page.y - height < pdfMargin) page = addPage();
    };

    if (table.title) {
      ensureSpace(22);
      drawText(page, table.title, pdfMargin, page.y, pdfSubheadingFontSize + 1);
      page.y -= 17;
    }

    ensureSpace(getTableHeaderHeight(table.headers, columnWidths));
    drawTableHeader(page, table.headers, columnWidths);

    rows.forEach((row) => {
      const cells = columns.map((columnIndex) => normalizeCell(row[columnIndex] ?? ""));
      const wrappedCells = cells.map((cell, index) =>
        wrapText(cell, getMaxCharsForColumn(columnWidths[index])),
      );
      const rowHeight = Math.max(
        pdfMinRowHeight,
        Math.max(...wrappedCells.map((cellLines) => cellLines.length)) * pdfLineHeight +
          pdfCellPaddingY * 2,
      );

      if (page.y - rowHeight < pdfMargin) {
        page = addPage();
        ensureSpace(getTableHeaderHeight(table.headers, columnWidths));
        drawTableHeader(page, table.headers, columnWidths);
      }
      drawTableRow(page, wrappedCells, columnWidths, rowHeight);
    });

    page.y -= 24;
  });

  return pages;
}

function createPdfPage(): PdfPage {
  return { commands: [], y: pdfPageHeight - pdfMargin };
}

function addPdfPageNumbers(pages: PdfPage[]) {
  const totalPages = pages.length;
  pages.forEach((page, index) => {
    drawTextRight(
      page,
      `${index + 1} of ${totalPages}`,
      pdfPageWidth - pdfMargin,
      pdfMargin / 2,
      pdfFontSize,
    );
  });
}

function drawTableHeader(page: PdfPage, headers: string[], columnWidths: number[]) {
  const columns = normalizeColumns(headers.length);
  const cells = columns.map((columnIndex) => normalizeCell(headers[columnIndex] ?? ""));
  const wrappedCells = cells.map((cell, index) =>
    wrapText(cell, getMaxCharsForColumn(columnWidths[index])),
  );
  const rowHeight = getWrappedCellsHeight(wrappedCells);
  drawTableRow(page, wrappedCells, columnWidths, rowHeight, true);
}

function getTableHeaderHeight(headers: string[], columnWidths: number[]) {
  const cells = normalizeColumns(headers.length).map((columnIndex) =>
    normalizeCell(headers[columnIndex] ?? ""),
  );
  const wrappedCells = cells.map((cell, index) =>
    wrapText(cell, getMaxCharsForColumn(columnWidths[index])),
  );
  return getWrappedCellsHeight(wrappedCells);
}

function getWrappedCellsHeight(wrappedCells: string[][]) {
  return Math.max(
    pdfMinRowHeight,
    Math.max(...wrappedCells.map((cellLines) => cellLines.length)) * pdfLineHeight +
      pdfCellPaddingY * 2,
  );
}

function drawTableRow(
  page: PdfPage,
  wrappedCells: string[][],
  columnWidths: number[],
  rowHeight: number,
  isHeader = false,
) {
  let x = pdfMargin;
  const yTop = page.y;
  const yBottom = yTop - rowHeight;

  columnWidths.forEach((width, index) => {
    if (isHeader) {
      page.commands.push("0.95 0.96 0.98 rg");
      page.commands.push(
        `${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re f`,
      );
    }
    page.commands.push("0.78 0.80 0.84 RG");
    page.commands.push("0.6 w");
    page.commands.push(
      `${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re S`,
    );

    wrappedCells[index].forEach((line, lineIndex) => {
      const textY = yTop - pdfCellPaddingY - pdfFontSize - lineIndex * pdfLineHeight;
      drawText(page, line, x + pdfCellPaddingX, textY, pdfFontSize);
    });
    x += width;
  });

  page.y = yBottom;
}

function drawDescriptionTable(
  page: PdfPage,
  rows: Array<{ label: string; value: string }>,
  addPage: AddPdfPage,
) {
  const labelWidth = 148;
  const valueWidth = pdfContentWidth - labelWidth;
  const columnWidths = [labelWidth, valueWidth];
  const headerHeight = pdfMinRowHeight;
  if (page.y - headerHeight < pdfMargin) {
    page = addPage();
  }
  drawTableRow(
    page,
    [["Export detail"], ["Selection / note"]],
    columnWidths,
    headerHeight,
    true,
  );

  rows.forEach((row) => {
    const wrappedCells = [
      wrapText(row.label, getMaxCharsForColumn(columnWidths[0])),
      wrapText(row.value, getMaxCharsForColumn(columnWidths[1])),
    ];
    const rowHeight = Math.max(
      pdfMinRowHeight,
      Math.max(...wrappedCells.map((cellLines) => cellLines.length)) * pdfLineHeight +
        pdfCellPaddingY * 2,
    );
    if (page.y - rowHeight < pdfMargin) {
      page = addPage();
      drawTableRow(
        page,
        [["Export detail"], ["Selection / note"]],
        columnWidths,
        headerHeight,
        true,
      );
    }
    drawTableRow(page, wrappedCells, columnWidths, rowHeight);
  });
  return page;
}

function drawDescriptionNotes(page: PdfPage, notes: string[], addPage: AddPdfPage) {
  const columnWidths = [pdfContentWidth];
  const headerHeight = pdfMinRowHeight;
  if (page.y - headerHeight < pdfMargin) {
    page = addPage();
  }
  drawTableRow(page, [["Notes"]], columnWidths, headerHeight, true);

  notes.forEach((note) => {
    const wrappedCells = [wrapText(note, getMaxCharsForColumn(columnWidths[0]))];
    const rowHeight = getWrappedCellsHeight(wrappedCells);
    if (page.y - rowHeight < pdfMargin) {
      page = addPage();
      drawTableRow(page, [["Notes"]], columnWidths, headerHeight, true);
    }
    drawTableRow(page, wrappedCells, columnWidths, rowHeight);
  });
  return page;
}

function drawText(page: PdfPage, value: string, x: number, y: number, fontSize: number) {
  page.commands.push("0 0 0 rg");
  page.commands.push("BT");
  page.commands.push(`/F1 ${formatPdfNumber(fontSize)} Tf`);
  page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(y)} Td`);
  page.commands.push(`(${escapePdfText(value)}) Tj`);
  page.commands.push("ET");
}

function drawTextRight(page: PdfPage, value: string, rightX: number, y: number, fontSize: number) {
  const estimatedWidth = value.length * fontSize * 0.48;
  drawText(page, value, Math.max(pdfMargin, rightX - estimatedWidth), y, fontSize);
}

function normalizeColumns(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => index);
}

function getPdfTableSegments(table: ExportTable): ExportTable[] {
  const maxPdfColumns = 8;
  if (table.headers.length <= maxPdfColumns || table.columnWidths) return [table];

  const repeatedColumnCount = getRepeatedPdfColumnCount(table.headers);
  const repeatedIndexes = normalizeColumns(repeatedColumnCount);
  const detailIndexes = table.headers
    .map((_, index) => index)
    .filter((index) => index >= repeatedColumnCount);
  const chunkSize = Math.max(1, maxPdfColumns - repeatedColumnCount);
  const chunks: number[][] = [];
  for (let index = 0; index < detailIndexes.length; index += chunkSize) {
    chunks.push(detailIndexes.slice(index, index + chunkSize));
  }
  if (chunks.length <= 1) return [table];

  return chunks.map((chunk, index) => {
    const indexes = [...repeatedIndexes, ...chunk];
    return {
      title: `${table.title ?? "Table"} (${index + 1}/${chunks.length})`,
      headers: indexes.map((columnIndex) => table.headers[columnIndex] ?? ""),
      rows: table.rows.map((row) => indexes.map((columnIndex) => row[columnIndex] ?? "")),
    };
  });
}

function getRepeatedPdfColumnCount(headers: string[]) {
  const normalizedFirstHeader = String(headers[0] ?? "").toLowerCase();
  if (/^s\.?\s*no\.?$|^serial/.test(normalizedFirstHeader)) return Math.min(2, headers.length);
  return 1;
}

function getColumnWidths(headers: string[], rows: string[][], requestedWidths?: number[]) {
  const columns = normalizeColumns(headers.length);
  if (
    requestedWidths?.length === columns.length &&
    requestedWidths.every((width) => Number.isFinite(width) && width > 0)
  ) {
    const total = requestedWidths.reduce((sum, width) => sum + width, 0);
    return requestedWidths.map((width) => (width / total) * pdfContentWidth);
  }
  if (columns.length === 1) return [pdfContentWidth];
  const profiles = columns.map((index) => getPdfColumnProfile(headers[index] ?? "", index));
  const desiredWidths = columns.map((index) => {
    const profile = profiles[index];
    const contentWidth = estimateColumnContentWidth(
      headers[index] ?? "",
      rows.map((row) => row[index] ?? ""),
      profile,
    );
    return clampNumber(Math.max(profile.base, contentWidth), profile.min, profile.max);
  });
  return fitColumnWidthsToPage(
    desiredWidths,
    profiles.map((profile) => profile.min),
    profiles.map((profile) => profile.max),
  );
}

type PdfColumnProfile = {
  min: number;
  base: number;
  max: number;
  contentCap: number;
};

function getPdfColumnProfile(header: string, index: number): PdfColumnProfile {
  const normalized = normalizeHeaderForWidth(header);
  if (index === 0 && /^(sno|serial|srno|slno)$/.test(normalized)) {
    return { min: 30, base: 36, max: 42, contentCap: 8 };
  }
  if (
    /^(sno|serial|srno|slno|so|sono|stage|deliverystage|supplementarybill|billreturncycle)$/.test(
      normalized,
    )
  ) {
    return { min: 34, base: 42, max: 60, contentCap: 12 };
  }
  if (/(date|period|fy|year|dp|validity|expiry)/.test(normalized)) {
    return { min: 58, base: 68, max: 88, contentCap: 16 };
  }
  if (/(amount|value|capital|revenue|cost|price|payment|paid|balance|allocation)/.test(normalized)) {
    return { min: 64, base: 78, max: 108, contentCap: 18 };
  }
  if (/(yes|no|count|qty|quantity|number|mode|type|category|status|flag)/.test(normalized)) {
    return { min: 46, base: 62, max: 92, contentCap: 18 };
  }
  if (/(description|remark|remarks|details|address|scope|subject|title|item|milestone|firm|vendor|indentor|division|reference)/.test(normalized)) {
    return { min: 92, base: 132, max: 240, contentCap: 48 };
  }
  return { min: 58, base: 82, max: 150, contentCap: 28 };
}

function normalizeHeaderForWidth(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function estimateColumnContentWidth(
  header: string,
  values: string[],
  profile: PdfColumnProfile,
) {
  const samples = [header, ...values.slice(0, 80)].map(normalizeCell);
  const contentScore = samples.reduce((max, value) => {
    const longestWord = value.split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 0);
    const usefulLength = Math.min(value.length, profile.contentCap);
    return Math.max(max, Math.max(usefulLength * 0.72, longestWord));
  }, 0);
  return pdfCellPaddingX * 2 + contentScore * pdfFontSize * 0.5;
}

function fitColumnWidthsToPage(widths: number[], mins: number[], maxes: number[]) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (Math.abs(total - pdfContentWidth) < 0.5) return widths;
  if (total > pdfContentWidth) {
    return shrinkColumnWidths(widths, mins, total - pdfContentWidth);
  }
  return growColumnWidths(widths, maxes, pdfContentWidth - total);
}

function shrinkColumnWidths(widths: number[], mins: number[], overflow: number) {
  const next = [...widths];
  let remaining = overflow;
  for (let pass = 0; pass < 6 && remaining > 0.5; pass += 1) {
    const shrinkableIndexes = next
      .map((width, index) => ({ index, capacity: Math.max(0, width - mins[index]) }))
      .filter((item) => item.capacity > 0);
    if (!shrinkableIndexes.length) break;
    const totalCapacity = shrinkableIndexes.reduce((sum, item) => sum + item.capacity, 0);
    shrinkableIndexes.forEach(({ index, capacity }) => {
      const reduction = Math.min(capacity, remaining * (capacity / totalCapacity));
      next[index] -= reduction;
    });
    remaining = next.reduce((sum, width) => sum + width, 0) - pdfContentWidth;
  }
  return normalizeWidthRounding(next);
}

function growColumnWidths(widths: number[], maxes: number[], extra: number) {
  const next = [...widths];
  let remaining = extra;
  for (let pass = 0; pass < 6 && remaining > 0.5; pass += 1) {
    const growableIndexes = next
      .map((width, index) => ({ index, capacity: Math.max(0, maxes[index] - width) }))
      .filter((item) => item.capacity > 0);
    if (!growableIndexes.length) break;
    const totalCapacity = growableIndexes.reduce((sum, item) => sum + item.capacity, 0);
    growableIndexes.forEach(({ index, capacity }) => {
      const addition = Math.min(capacity, remaining * (capacity / totalCapacity));
      next[index] += addition;
    });
    remaining = pdfContentWidth - next.reduce((sum, width) => sum + width, 0);
  }
  if (remaining > 0.5) {
    const addition = remaining / next.length;
    return normalizeWidthRounding(next.map((width) => width + addition));
  }
  return normalizeWidthRounding(next);
}

function normalizeWidthRounding(widths: number[]) {
  const rounded = widths.map((width) => Number(width.toFixed(2)));
  const delta = Number((pdfContentWidth - rounded.reduce((sum, width) => sum + width, 0)).toFixed(2));
  if (rounded.length) rounded[rounded.length - 1] += delta;
  return rounded;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getMaxCharsForColumn(width: number) {
  return Math.max(8, Math.floor((width - pdfCellPaddingX * 2) / (pdfFontSize * 0.48)));
}

function normalizeCell(value: string) {
  return (
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim() || "-"
  );
}

function wrapText(value: string, maxLength: number) {
  const text = normalizeCell(value);
  if (text.length <= maxLength) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const breakAt = remaining.lastIndexOf(" ", maxLength);
    const minimumUsefulBreak = Math.max(8, Math.floor(maxLength * 0.4));
    const index = breakAt >= minimumUsefulBreak ? breakAt : maxLength;
    lines.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function renderDescriptionHtml(sections: ExportDescriptionSections) {
  const detailsHtml = sections.details.length
    ? `<table class="description">
        <thead><tr><th>Export detail</th><th>Selection</th></tr></thead>
        <tbody>
          ${sections.details
            .map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`)
            .join("")}
        </tbody>
      </table>`
    : "";
  const notesHtml = sections.notes.length
    ? `<table class="description-notes">
        <tbody>
          ${sections.notes.map((note) => `<tr><td>${escapeHtml(note)}</td></tr>`).join("")}
        </tbody>
      </table>`
    : "";
  return `${detailsHtml}${notesHtml}`;
}

function parseExportDescriptionSections(description: string | undefined): ExportDescriptionSections {
  const sections: ExportDescriptionSections = { details: [], notes: [] };
  splitExportDescription(description).forEach((line) => {
    const pair = parseExportDescriptionPair(line);
    if (pair) {
      sections.details.push(pair);
    } else {
      sections.notes.push(line);
    }
  });
  return sections;
}

function parseExportDescriptionPair(line: string): { label: string; value: string } | undefined {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex <= 0) return undefined;
  const label = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();
  if (!label || !value || label.length > 48 || !isExportDetailLabel(label)) return undefined;
  return { label, value };
}

function isExportDetailLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return (
    /^(global filter|file year subfilter|file year|financial year|fy|division|file category|category|initiation date range|date range|as-on date|as on date|selected month|month|report|filter|subfilter|value type|payment mode|stage|milestone|generated by|layout|files)$/.test(
      normalized,
    ) || /^(global|selected|active|from|to) /.test(normalized)
  );
}

function splitExportDescription(description: string | undefined) {
  if (!description) return [];
  return protectDescriptionAbbreviations(description)
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?;])\s+(?=[A-Z0-9])/))
    .map((line) =>
      restoreDescriptionAbbreviations(line)
        .trim()
        .replace(/^[-*]\s+/, ""),
    )
    .filter(Boolean);
}

function protectDescriptionAbbreviations(text: string) {
  return text
    .replaceAll("S.O.", "S__O__")
    .replaceAll("D.P.", "D__P__")
    .replaceAll("F.Y.", "F__Y__")
    .replaceAll("FY.", "FY__")
    .replaceAll("No.", "No__");
}

function restoreDescriptionAbbreviations(text: string) {
  return text
    .replaceAll("S__O__", "S.O.")
    .replaceAll("D__P__", "D.P.")
    .replaceAll("F__Y__", "F.Y.")
    .replaceAll("FY__", "FY.")
    .replaceAll("No__", "No.");
}

function formatGeneratedAt() {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
}

function formatPdfNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
