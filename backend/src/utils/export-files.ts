type ExportTable = {
  title?: string;
  headers: string[];
  rows: string[][];
  columnWidths?: number[];
  emphasizedColumns?: number[];
};

type ExportDocument = {
  title: string;
  subtitle?: string;
  description?: string;
  tables: ExportTable[];
  plot?: ExportPlot;
  plots?: ExportPlot[];
};

type ExportPlot = {
  kind: "bar" | "line" | "pie";
  title: string;
  measure: string;
  unit?: string;
  xAxisTitle?: string;
  yAxisTitle?: string;
  expandedYears?: string[];
  compactBars?: boolean;
  stackedBars?: boolean;
  categories: string[];
  series: Array<{ name: string; values: number[]; color?: string }>;
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

export function getExportFileName(title: string, extension: "xlsx" | "pdf") {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  return `${base}.${extension}`;
}

export function renderExcelDocument(document: ExportDocument) {
  return renderXlsxDocument(document);
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
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  pages.forEach((page) => {
    const pageObjectId = objects.length + 1;
    const contentObjectId = pageObjectId + 1;
    pageObjectIds.push(pageObjectId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidth} ${pdfPageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
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

  const plots = [...(document.plot ? [document.plot] : []), ...(document.plots ?? [])];
  const pdfTables = plots.length
    ? [
        ...plots.map((plot) => ({
          title: `Chart data · ${plot.title} · ${plot.measure}${plot.unit ? ` (${plot.unit})` : ""}`,
          headers: ["Period", ...plot.series.map((series) => series.name)],
          rows: plot.categories.map((category, index) => [
            category,
            ...plot.series.map((series) => String(series.values[index] ?? 0)),
          ]),
        })),
        ...document.tables,
      ]
    : document.tables;
  plots.forEach((plot) => {
    page = drawExportPlot(page, plot, addPage);
  });

  pdfTables.flatMap(getPdfTableSegments).forEach((table) => {
    const columns = normalizeColumns(table.headers.length);
    const columnWidths = getColumnWidths(table.headers, table.rows, table.columnWidths);
    const emphasizedColumns = new Set(table.emphasizedColumns ?? []);
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
    drawTableHeader(page, table.headers, columnWidths, emphasizedColumns);

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
        drawTableHeader(page, table.headers, columnWidths, emphasizedColumns);
      }
      drawTableRow(page, wrappedCells, columnWidths, rowHeight, false, emphasizedColumns);
    });

    page.y -= 24;
  });

  return pages;
}

function drawExportPlot(page: PdfPage, plot: ExportPlot, addPage: AddPdfPage) {
  const colors = ["0.06 0.46 0.43", "0.15 0.39 0.92", "0.78 0.25 0.12", "0.50 0.30 0.68"];
  const categories = plot.categories;
  const series = plot.series.slice(0, 4);
  const seriesColors = series.map((item, index) =>
    item.color && /^#[0-9a-f]{6}$/i.test(item.color)
      ? item.color
          .slice(1)
          .match(/.{2}/g)!
          .map((channel) => (parseInt(channel, 16) / 255).toFixed(3))
          .join(" ")
      : colors[index],
  );
  if (!categories.length || !series.length) {
    if (page.y - 50 < pdfMargin) page = addPage();
    drawText(page, plot.title, pdfMargin, page.y, pdfSubheadingFontSize + 1, true);
    page.y -= 18;
    drawText(page, "No plotted values.", pdfMargin, page.y, pdfFontSize);
    page.y -= 24;
    return page;
  }
  const chartLeft = plot.kind === "bar" ? pdfMargin + 160 : pdfMargin + 38;
  const chartRight = pdfPageWidth - pdfMargin - 12;
  const chartWidth = chartRight - chartLeft;
  const details = [`Measure: ${plot.measure}`, plot.unit, plot.expandedYears?.length ? `Expanded years: ${plot.expandedYears.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
  const pageSize =
    plot.kind === "line"
      ? 12
      : plot.kind === "pie" || plot.compactBars
        ? categories.length
        : 18;
  const pageCount = Math.ceil(categories.length / pageSize);
  const maxValue = Math.max(
    1,
    ...(plot.stackedBars
      ? categories.map((_, index) =>
          series.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0),
        )
      : series.flatMap((item) => item.values.map((value) => Math.max(0, value)))),
  );

  for (let offset = 0; offset < categories.length; offset += pageSize) {
    if (page.y - 410 < pdfMargin) page = addPage();
    const pageCategories = categories.slice(offset, offset + pageSize);
    const suffix = pageCount > 1 ? ` (${Math.floor(offset / pageSize) + 1}/${pageCount})` : "";
    drawText(page, `${plot.title}${suffix}`, pdfMargin, page.y, pdfSubheadingFontSize + 1, true);
    page.y -= 16;
    if (details) {
      drawText(page, details, pdfMargin, page.y, pdfFontSize);
      page.y -= 18;
    }
    series.forEach((item, index) => {
      const x = pdfMargin + (index % 2) * 250;
      const y = page.y - 3 - Math.floor(index / 2) * 13;
      page.commands.push(`${seriesColors[index]} rg`);
      page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(y - 2)} 7 7 re f`);
      drawText(page, item.name, x + 11, y - 1, pdfFontSize - 1);
    });

    const chartTop = page.y - 24;
    const chartBottom = pdfMargin + 54;
    const chartHeight = chartTop - chartBottom;
    if (plot.kind === "pie") {
      const pieValues = series[0].values.slice(offset, offset + pageCategories.length).map((value) => Math.max(0, value));
      const pieTotal = pieValues.reduce((sum, value) => sum + value, 0);
      const centerX = pdfMargin + 290;
      const centerY = chartBottom + Math.min(170, chartHeight * 0.48);
      const radius = Math.min(115, chartHeight * 0.38);
      let angle = -Math.PI / 2;
      pageCategories.forEach((category, index) => {
        const value = pieValues[index] ?? 0;
        const sweep = pieTotal > 0 ? (value / pieTotal) * Math.PI * 2 : 0;
        const points = Math.max(2, Math.ceil(sweep * 24));
        page.commands.push(`${colors[index % colors.length]} rg`);
        page.commands.push(`${formatPdfNumber(centerX)} ${formatPdfNumber(centerY)} m`);
        page.commands.push(`${formatPdfNumber(centerX + Math.cos(angle) * radius)} ${formatPdfNumber(centerY + Math.sin(angle) * radius)} l`);
        for (let point = 1; point <= points; point += 1) {
          const nextAngle = angle + (sweep * point) / points;
          page.commands.push(`${formatPdfNumber(centerX + Math.cos(nextAngle) * radius)} ${formatPdfNumber(centerY + Math.sin(nextAngle) * radius)} l`);
        }
        page.commands.push("h f");
        const share = pieTotal ? Math.round((value / pieTotal) * 100) : 0;
        const legendY = chartTop - 24 - index * 15;
        page.commands.push(`${colors[index % colors.length]} rg`);
        page.commands.push(`${formatPdfNumber(pdfMargin + 515)} ${formatPdfNumber(legendY - 2)} 7 7 re f`);
        drawText(page, `${category.slice(0, 32)}: ${value} (${share}%)`, pdfMargin + 527, legendY - 1, pdfFontSize - 1);
        angle += sweep;
      });
    } else if (plot.kind === "line") {
      const plotTop = chartTop - 12;
      const plotBottom = chartBottom + 10;
      const xStep = pageCategories.length > 1 ? chartWidth / (pageCategories.length - 1) : 0;
      page.commands.push("0.7 0.73 0.78 RG 0.7 w");
      page.commands.push(`${formatPdfNumber(chartLeft)} ${formatPdfNumber(plotBottom)} m ${formatPdfNumber(chartRight)} ${formatPdfNumber(plotBottom)} l S`);
      series.forEach((item, seriesIndex) => {
        page.commands.push(`${seriesColors[seriesIndex]} RG 1.8 w`);
        const points = pageCategories.map((_, index) => ({
          x: chartLeft + index * xStep,
          y: plotBottom + (Math.max(0, item.values[offset + index] ?? 0) / maxValue) * (plotTop - plotBottom),
        }));
        if (points.length) {
          page.commands.push(`${formatPdfNumber(points[0].x)} ${formatPdfNumber(points[0].y)} m`);
          points.slice(1).forEach((point) => page.commands.push(`${formatPdfNumber(point.x)} ${formatPdfNumber(point.y)} l`));
          page.commands.push("S");
          points.forEach((point) => page.commands.push(`${formatPdfNumber(point.x - 2)} ${formatPdfNumber(point.y - 2)} 4 4 re f`));
        }
      });
      pageCategories.forEach((category, index) => {
        const x = chartLeft + index * xStep;
        drawText(page, category.slice(0, 13), x - 18, chartBottom - 13, pdfFontSize - 2);
      });
    } else {
      const rowHeight = chartHeight / pageSize;
      const groupHeight = Math.max(4, rowHeight / (series.length + 1));
      pageCategories.forEach((category, categoryIndex) => {
        const yTop = chartTop - categoryIndex * rowHeight;
        drawText(page, category.slice(0, 28), pdfMargin, yTop - groupHeight, pdfFontSize - 1);
        if (plot.stackedBars) {
          let x = chartLeft;
          let total = 0;
          series.forEach((item, seriesIndex) => {
            const value = Math.max(0, item.values[offset + categoryIndex] ?? 0);
            total += value;
            const width = chartWidth * (value / maxValue);
            page.commands.push(`${seriesColors[seriesIndex]} rg`);
            page.commands.push(`${formatPdfNumber(x)} ${formatPdfNumber(yTop - groupHeight)} ${formatPdfNumber(width)} ${formatPdfNumber(Math.max(2, groupHeight - 1))} re f`);
            x += width;
          });
          if (total > 0) {
            drawText(page, String(total), Math.min(chartRight - 12, x + 3), yTop - groupHeight + 1, pdfFontSize - 2);
          }
          return;
        }
        series.forEach((item, seriesIndex) => {
          const value = Math.max(0, item.values[offset + categoryIndex] ?? 0);
          const y = yTop - (seriesIndex + 1) * groupHeight;
          const width = chartWidth * (value / maxValue);
          page.commands.push(`${seriesColors[seriesIndex]} rg`);
          page.commands.push(`${formatPdfNumber(chartLeft)} ${formatPdfNumber(y)} ${formatPdfNumber(Math.max(value ? 1 : 0, width))} ${formatPdfNumber(Math.max(2, groupHeight - 1))} re f`);
          if (value > 0) drawText(page, String(value), Math.min(chartRight - 12, chartLeft + width + 3), y + 1, pdfFontSize - 2);
        });
      });
    }
    page.y = pdfMargin + 20;
    if (offset + pageSize < categories.length) page = addPage();
  }
  return page;
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

function drawTableHeader(
  page: PdfPage,
  headers: string[],
  columnWidths: number[],
  emphasizedColumns = new Set<number>(),
) {
  const columns = normalizeColumns(headers.length);
  const cells = columns.map((columnIndex) => normalizeCell(headers[columnIndex] ?? ""));
  const wrappedCells = cells.map((cell, index) =>
    wrapText(cell, getMaxCharsForColumn(columnWidths[index])),
  );
  const rowHeight = getWrappedCellsHeight(wrappedCells);
  drawTableRow(page, wrappedCells, columnWidths, rowHeight, true, emphasizedColumns);
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
  emphasizedColumns = new Set<number>(),
) {
  let x = pdfMargin;
  const yTop = page.y;
  const yBottom = yTop - rowHeight;

  columnWidths.forEach((width, index) => {
    const emphasized = emphasizedColumns.has(index);
    if (isHeader || emphasized) {
      page.commands.push(
        isHeader && emphasized
          ? "0.86 0.92 0.98 rg"
          : isHeader
            ? "0.95 0.96 0.98 rg"
            : "0.93 0.96 0.99 rg",
      );
      page.commands.push(
        `${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re f`,
      );
    }
    page.commands.push("0.78 0.80 0.84 RG");
    page.commands.push("0.6 w");
    page.commands.push(
      `${formatPdfNumber(x)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(width)} ${formatPdfNumber(rowHeight)} re S`,
    );

    page.commands.push("q");
    page.commands.push(
      `${formatPdfNumber(x + 1)} ${formatPdfNumber(yBottom + 1)} ${formatPdfNumber(
        Math.max(1, width - 2),
      )} ${formatPdfNumber(Math.max(1, rowHeight - 2))} re W n`,
    );
    wrappedCells[index].forEach((line, lineIndex) => {
      const textY = yTop - pdfCellPaddingY - pdfFontSize - lineIndex * pdfLineHeight;
      drawText(page, line, x + pdfCellPaddingX, textY, pdfFontSize, emphasized);
    });
    page.commands.push("Q");
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
  drawTableRow(page, [["Export detail"], ["Selection / note"]], columnWidths, headerHeight, true);

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
    drawTableRow(page, wrappedCells, columnWidths, rowHeight, false, new Set([0]));
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

function drawText(
  page: PdfPage,
  value: string,
  x: number,
  y: number,
  fontSize: number,
  bold = false,
) {
  page.commands.push("0 0 0 rg");
  page.commands.push("BT");
  page.commands.push(`/F${bold ? "2" : "1"} ${formatPdfNumber(fontSize)} Tf`);
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
      emphasizedColumns: indexes.flatMap((columnIndex, index) =>
        table.emphasizedColumns?.includes(columnIndex) ? [index] : [],
      ),
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
  if (
    /(amount|value|capital|revenue|cost|price|payment|paid|balance|allocation)/.test(normalized)
  ) {
    return { min: 64, base: 78, max: 108, contentCap: 18 };
  }
  if (/(yes|no|count|qty|quantity|number|mode|type|category|status|flag)/.test(normalized)) {
    return { min: 46, base: 62, max: 92, contentCap: 18 };
  }
  if (
    /(description|remark|remarks|details|address|scope|subject|title|item|milestone|firm|vendor|indentor|division|reference)/.test(
      normalized,
    )
  ) {
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

function estimateColumnContentWidth(header: string, values: string[], profile: PdfColumnProfile) {
  const samples = [header, ...values.slice(0, 80)].map(normalizeCell);
  const contentScore = samples.reduce((max, value) => {
    const longestWord = value
      .split(/\s+/)
      .reduce((longest, word) => Math.max(longest, word.length), 0);
    const usefulLength = Math.min(value.length, profile.contentCap);
    return Math.max(max, Math.max(usefulLength * 0.72, longestWord));
  }, 0);
  return pdfCellPaddingX * 2 + contentScore * getPdfAverageCharacterWidth(pdfFontSize);
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
  const delta = Number(
    (pdfContentWidth - rounded.reduce((sum, width) => sum + width, 0)).toFixed(2),
  );
  if (rounded.length) rounded[rounded.length - 1] += delta;
  return rounded;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getMaxCharsForColumn(width: number) {
  return Math.max(
    5,
    Math.floor((width - pdfCellPaddingX * 2) / getPdfAverageCharacterWidth(pdfFontSize)),
  );
}

function getPdfAverageCharacterWidth(fontSize: number) {
  return fontSize * 0.62;
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
            .map(
              (row) =>
                `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`,
            )
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

function parseExportDescriptionSections(
  description: string | undefined,
): ExportDescriptionSections {
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
    /^(global filter|file year subfilter|file year|financial year|fy|division|file category|category|initiation date range|date range|as-on date|as on date|selected month|month|report|source|filter|filters|subfilter|value type|payment mode|stage|milestone|generated by|layout|files)$/.test(
      normalized,
    ) ||
    /^(global|selected|active|from|to) /.test(normalized) ||
    normalized === "analysis basis" ||
    /^(sort field|order|plan fy|bill payment offset|bill submission offset|d\.p\. offset)$/.test(
      normalized,
    )
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
import { renderXlsxDocument } from "./export-xlsx.js";
