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
        </style>
      </head>
      <body>
        <h1>${escapeHtml(document.title)}</h1>
        ${document.subtitle ? `<p>${escapeHtml(document.subtitle)}</p>` : ""}
        ${document.description ? `<p>${escapeHtml(document.description)}</p>` : ""}
        ${tables}
      </body>
    </html>`;
}

export function renderPdfDocument(document: ExportDocument) {
  const pages = renderPdfPages(document);

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
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

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

  const addPage = () => {
    page = createPdfPage();
    pages.push(page);
  };

  drawText(page, document.title, pdfMargin, page.y, pdfTitleFontSize);
  page.y -= 24;
  if (document.subtitle) {
    drawText(page, document.subtitle, pdfMargin, page.y, pdfSubheadingFontSize);
    page.y -= 15;
  }
  if (document.description) {
    wrapText(document.description, 145).forEach((line) => {
      drawText(page, line, pdfMargin, page.y, pdfSubheadingFontSize);
      page.y -= 13;
    });
  }
  page.y -= 8;

  document.tables.forEach((table) => {
    const columns = normalizeColumns(table.headers.length);
    const columnWidths = getColumnWidths(columns, table.columnWidths);
    const rows = table.rows.length ? table.rows : [["No rows found."]];

    const ensureSpace = (height: number) => {
      if (page.y - height < pdfMargin) addPage();
    };

    if (table.title) {
      ensureSpace(22);
      drawText(page, table.title, pdfMargin, page.y, pdfSubheadingFontSize + 1);
      page.y -= 17;
    }

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
        addPage();
        drawTableHeader(page, table.headers, columnWidths);
      }
      drawTableRow(page, wrappedCells, columnWidths, rowHeight);
    });

    page.y -= 14;
  });

  return pages;
}

function createPdfPage(): PdfPage {
  return { commands: [], y: pdfPageHeight - pdfMargin };
}

function drawTableHeader(page: PdfPage, headers: string[], columnWidths: number[]) {
  const columns = normalizeColumns(headers.length);
  const cells = columns.map((columnIndex) => normalizeCell(headers[columnIndex] ?? ""));
  const wrappedCells = cells.map((cell, index) =>
    wrapText(cell, getMaxCharsForColumn(columnWidths[index])),
  );
  const rowHeight = Math.max(
    pdfMinRowHeight,
    Math.max(...wrappedCells.map((cellLines) => cellLines.length)) * pdfLineHeight +
      pdfCellPaddingY * 2,
  );
  if (page.y - rowHeight < pdfMargin) {
    page.y = pdfPageHeight - pdfMargin;
  }
  drawTableRow(page, wrappedCells, columnWidths, rowHeight, true);
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
      page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re f`);
    }
    page.commands.push("0.78 0.80 0.84 RG");
    page.commands.push("0.6 w");
    page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re S`);

    wrappedCells[index].forEach((line, lineIndex) => {
      const textY = yTop - pdfCellPaddingY - pdfFontSize - lineIndex * pdfLineHeight;
      drawText(page, line, x + pdfCellPaddingX, textY, pdfFontSize);
    });
    x += width;
  });

  page.y = yBottom;
}

function drawText(page: PdfPage, value: string, x: number, y: number, fontSize: number) {
  page.commands.push("0 0 0 rg");
  page.commands.push("BT");
  page.commands.push(`/F1 ${formatPdfNumber(fontSize)} Tf`);
  page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(y)} Td`);
  page.commands.push(`(${escapePdfText(value)}) Tj`);
  page.commands.push("ET");
}

function normalizeColumns(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => index);
}

function getColumnWidths(columns: number[], requestedWidths?: number[]) {
  if (
    requestedWidths?.length === columns.length &&
    requestedWidths.every((width) => Number.isFinite(width) && width > 0)
  ) {
    const total = requestedWidths.reduce((sum, width) => sum + width, 0);
    return requestedWidths.map((width) => (width / total) * pdfContentWidth);
  }
  if (columns.length === 1) return [pdfContentWidth];
  const serialWidth = columns.length > 2 ? 42 : 70;
  const remainingWidth = pdfContentWidth - serialWidth;
  return columns.map((_, index) =>
    index === 0 ? serialWidth : remainingWidth / Math.max(1, columns.length - 1),
  );
}

function getMaxCharsForColumn(width: number) {
  return Math.max(8, Math.floor((width - pdfCellPaddingX * 2) / (pdfFontSize * 0.48)));
}

function normalizeCell(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim() || "-";
}

function wrapText(value: string, maxLength: number) {
  const text = normalizeCell(value);
  if (text.length <= maxLength) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const breakAt = remaining.lastIndexOf(" ", maxLength);
    const index = breakAt > 20 ? breakAt : maxLength;
    lines.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
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
