import { deflateRawSync } from "node:zlib";

type ExportTable = {
  title?: string;
  headers: string[];
  rows: string[][];
  numericColumns?: number[];
  dateColumns?: number[];
  dateTimeColumns?: number[];
  columnWidths?: number[];
  emphasizedColumns?: number[];
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

type ExportDocument = {
  title: string;
  subtitle?: string;
  description?: string;
  tables: ExportTable[];
  sheets?: Array<{ name: string; tables: ExportTable[] }>;
  plot?: ExportPlot;
  plots?: ExportPlot[];
};

const xmlEscape = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function makeCell(reference: string, value: unknown, style = 0) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function makeNumberCell(reference: string, value: number, style = 0) {
  return `<c r="${reference}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function toExcelDateSerial(value: unknown) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return timestamp / 86_400_000 + 25569;
}

function toExcelDateTimeSerial(value: unknown) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day || date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
  ) return undefined;
  return timestamp / 86_400_000 + 25569;
}

function worksheetXml(
  rows: string[][],
  columnWidths?: number[],
  emphasizedCells = new Map<number, Set<number>>(),
  rowStyles = new Map<number, number>(),
  numericCells = new Map<number, Set<number>>(),
  dateCells = new Map<number, Set<number>>(),
  dateTimeCells = new Map<number, Set<number>>(),
) {
  const cols = columnWidths?.length
    ? `<cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(60, width))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const emphasized = emphasizedCells.get(rowIndex)?.has(columnIndex);
        const baseStyle = rowStyles.get(rowIndex) ?? 0;
        const style = emphasized ? (baseStyle === 7 ? 8 : 1) : baseStyle;
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        if (numericCells.get(rowIndex)?.has(columnIndex)) {
          const numericValue = Number(String(value ?? "").replace(/,/g, "").trim());
          if (String(value ?? "").trim() && Number.isFinite(numericValue)) {
            return makeNumberCell(reference, numericValue, style);
          }
        }
        if (dateCells.get(rowIndex)?.has(columnIndex)) {
          const dateSerial = toExcelDateSerial(value);
          if (dateSerial !== undefined) return makeNumberCell(reference, dateSerial, 9);
        }
        if (dateTimeCells.get(rowIndex)?.has(columnIndex)) {
          const dateTimeSerial = toExcelDateTimeSerial(value);
          if (dateTimeSerial !== undefined) return makeNumberCell(reference, dateTimeSerial, 10);
        }
        return makeCell(reference, value, style);
      });
      const lineCount = Math.max(1, ...row.map((value) => String(value ?? "").split(/\r?\n/).length));
      const height = rowStyles.get(rowIndex) === 2
        ? ' ht="28" customHeight="1"'
        : lineCount > 1
          ? ` ht="${Math.min(120, lineCount * 16 + 4)}" customHeight="1"`
          : "";
      return `<row r="${rowIndex + 1}"${height}>${cells.join("")}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;
}

function chartWorksheetXml(chartCount: number, twoColumnLayout: boolean) {
  const chartsPerRow = twoColumnLayout ? 2 : 1;
  const lastRow = Math.max(1, Math.ceil(chartCount / chartsPerRow) * 22);
  const rows = Array.from({ length: lastRow }, (_, index) => `<row r="${index + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:P${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="16" width="12" customWidth="1"/></cols><sheetData>${rows}</sheetData><drawing r:id="rId1"/></worksheet>`;
}

function chartUnitTitle(unit?: string) {
  if (!unit) return "";
  if (/lakh/i.test(unit)) return "Lakhs";
  if (/inr|rupee|₹/i.test(unit)) return "INR";
  if (/count|files?|cases?|rows?/i.test(unit)) return unit.trim();
  return "";
}

function chartCategoryTitle(plot: ExportPlot) {
  const explicitTitle = plot.xAxisTitle?.trim();
  const chartContext = `${plot.title} ${plot.measure}`;
  if (/\bfirm\b/i.test(explicitTitle ?? "") || /\bfirms?\b/i.test(chartContext)) {
    return "Firm Name";
  }
  return explicitTitle && !/^category$/i.test(explicitTitle) ? explicitTitle : "Category";
}

function chartDataXml(plots: ExportPlot[]) {
  const rows: Array<Array<string | number | null>> = [];
  const ranges: Array<{ categoryColumn: number; firstSeriesRow: number; lastSeriesRow: number; seriesColumns: number[] }> = [];
  for (const plot of plots) {
    const start = rows.length;
    const seriesColumns = plot.series.map((_, index) => start + index + 2);
    rows.push([plot.title, ...plot.series.map((series) => series.name)]);
    plot.categories.forEach((category, index) => {
      rows.push([category, ...plot.series.map((series) => series.values[index] ?? 0)]);
    });
    ranges.push({
      categoryColumn: start + 1,
      firstSeriesRow: start + 2,
      lastSeriesRow: start + plot.categories.length + 1,
      seriesColumns,
    });
    rows.push([]);
  }
  const maxColumns = Math.max(2, ...rows.map((row) => row.length));
  const xmlRows = rows
    .map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        return typeof value === "number" ? makeNumberCell(reference, value) : makeCell(reference, value ?? "");
      });
      return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
    })
    .join("");
  return {
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="${maxColumns}" width="18" customWidth="1"/></cols><sheetData>${xmlRows}</sheetData></worksheet>`,
    ranges,
  };
}

function axisTitleXml(title: string) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(title)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function chartXml(
  plot: ExportPlot,
  range: { categoryColumn: number; firstSeriesRow: number; lastSeriesRow: number; seriesColumns: number[] },
  chartKind: "bar" | "line",
  chartIndex: number,
) {
  const categoryRange = `'Chart Data'!$${columnName(range.categoryColumn - 1)}$${range.firstSeriesRow}:$${columnName(range.categoryColumn - 1)}$${range.lastSeriesRow}`;
  const seriesXml = plot.series.map((series, index) => {
    const column = columnName(range.seriesColumns[index] - 1);
    const headerRow = range.firstSeriesRow - 1;
    const valuesRange = `'Chart Data'!$${column}$${range.firstSeriesRow}:$${column}$${range.lastSeriesRow}`;
    const seriesColor = series.color?.match(/^#[0-9a-f]{6}$/i)
      ? series.color.slice(1).toUpperCase()
      : ["4472C4", "ED7D31", "70AD47", "A5A5A5", "FFC000", "5B9BD5"][index % 6];
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>'Chart Data'!$${column}$${headerRow}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(series.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${seriesColor}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${seriesColor}"/></a:solidFill></a:ln></c:spPr><c:cat><c:strRef><c:f>${categoryRange}</c:f><c:strCache><c:ptCount val="${plot.categories.length}"/>${plot.categories.map((category, point) => `<c:pt idx="${point}"><c:v>${xmlEscape(category)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${valuesRange}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${plot.categories.length}"/>${series.values.map((value, point) => `<c:pt idx="${point}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val>${chartKind === "line" ? `<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>` : ""}</c:ser>`;
  }).join("");
  const axisIds = `<c:axId val="${100000 + chartIndex * 2}"/><c:axId val="${100001 + chartIndex * 2}"/>`;
  const cartesianChart = chartKind === "bar"
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="${plot.stackedBars ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${seriesXml}<c:gapWidth val="70"/>${axisIds}</c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${seriesXml}<c:marker val="1"/>${axisIds}</c:lineChart>`;
  const categoryAxis = `<c:catAx><c:axId val="${100000 + chartIndex * 2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml(chartCategoryTitle(plot))}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${100001 + chartIndex * 2}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>`;
  const unitTitle = chartUnitTitle(plot.unit);
  const valueAxis = `<c:valAx><c:axId val="${100001 + chartIndex * 2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${unitTitle ? axisTitleXml(unitTitle) : ""}<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${100000 + chartIndex * 2}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${xmlEscape(`${plot.title} · ${chartKind === "bar" ? "Bar chart" : "Line chart"}`)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${cartesianChart}${categoryAxis}${valueAxis}</c:plotArea>${plot.series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>` : ""}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function makeZip(files: Array<{ name: string; content: string | Buffer }>) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const source = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function renderXlsxDocument(document: ExportDocument) {
  const additionalSheets = document.sheets ?? [];
  const plots = [...(document.plot ? [document.plot] : []), ...(document.plots ?? [])]
    .filter((plot) => plot.categories.length > 0 && plot.series.length > 0);
  const chartSpecs: Array<{ plot: ExportPlot; kind: "pie" | "bar" | "line" }> = [];
  for (const plot of plots) {
    if (plot.kind === "pie") chartSpecs.push({ plot, kind: "pie" });
    else chartSpecs.push({ plot, kind: "bar" }, { plot, kind: "line" });
  }
  const reportRows: string[][] = [[document.title]];
  const emphasizedCells = new Map<number, Set<number>>();
  const rowStyles = new Map<number, number>([[0, 2]]);
  const numericCells = new Map<number, Set<number>>();
  const dateCells = new Map<number, Set<number>>();
  const dateTimeCells = new Map<number, Set<number>>();
  const appendRow = (row: string[], emphasizedColumns: number[] = [], style = 0) => {
    const rowIndex = reportRows.length;
    reportRows.push(row);
    if (style) rowStyles.set(rowIndex, style);
    if (emphasizedColumns.length) emphasizedCells.set(rowIndex, new Set(emphasizedColumns));
  };
  appendRow(["Generated at", new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date())], [], 3);
  const appendInfoLine = (line: string, style = 4) => {
    const separator = line.indexOf(":");
    if (separator > 0) {
      appendRow([line.slice(0, separator).trim(), line.slice(separator + 1).trim()], [], style);
    } else {
      appendRow([line], [], style);
    }
  };
  if (document.subtitle) appendInfoLine(document.subtitle);
  if (document.description) {
    document.description.split(/\r?\n/).forEach((line) => appendInfoLine(line));
    appendRow([]);
  }
  const columnWidths: number[] = [];
  for (const table of document.tables) {
    if (table.title) appendRow([table.title], [], 5);
    appendRow(table.headers, [], 6);
    (table.rows.length ? table.rows : [["No rows found."]]).forEach((row) => {
      const rowIndex = reportRows.length;
      appendRow(row, table.emphasizedColumns, 7);
      if (table.numericColumns?.length && table.rows.length) {
        numericCells.set(rowIndex, new Set(table.numericColumns));
      }
      if (table.dateColumns?.length && table.rows.length) {
        dateCells.set(rowIndex, new Set(table.dateColumns));
      }
      if (table.dateTimeColumns?.length && table.rows.length) {
        dateTimeCells.set(rowIndex, new Set(table.dateTimeColumns));
      }
    });
    const columnCount = table.headers.length;
    for (let index = 0; index < columnCount; index += 1) {
      const requestedWidth = table.columnWidths?.[index];
      const contentWidth = Math.max(
        table.headers[index]?.length ?? 0,
        ...table.rows.map((row) => String(row[index] ?? "").length),
      );
      const width = requestedWidth ?? Math.min(52, Math.max(10, contentWidth + 2));
      columnWidths[index] = Math.max(columnWidths[index] ?? 0, width);
    }
    appendRow([]);
  }
  for (const plot of plots) {
    appendRow([`Chart data · ${plot.title}`], [], 5);
    const unitTitle = chartUnitTitle(plot.unit);
    appendRow([`Measure: ${plot.measure}${unitTitle ? ` ${unitTitle}` : ""}`], [], 4);
    if (plot.expandedYears?.length) appendRow([`Expanded years: ${plot.expandedYears.join(", ")}`], [], 4);
    appendRow([chartCategoryTitle(plot), ...plot.series.map((series) => series.name)], [], 6);
    plot.categories.forEach((category, index) => {
      appendRow([category, ...plot.series.map((series) => String(series.values[index] ?? 0))]);
    });
    appendRow([]);
  }
  const chartData = chartDataXml(plots);
  const pieGrid = chartSpecs.length > 1 && chartSpecs.every(({ kind }) => kind === "pie");
  const drawingAnchors = chartSpecs.map((_, index) => {
    const row = (pieGrid ? Math.floor(index / 2) : index) * 22;
    const column = pieGrid ? (index % 2) * 8 : 0;
    const columnEnd = pieGrid ? column + 8 : 16;
    const chartHeight = 20;
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${columnEnd}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + chartHeight}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join("");
  const chartFiles = chartSpecs.map(({ plot, kind }, index) => ({
    name: `xl/charts/chart${index + 1}.xml`,
    content: kind === "pie"
      ? (() => {
          const range = chartData.ranges[plots.indexOf(plot)];
          const categoryColumn = columnName(range.categoryColumn - 1);
          const valueColumn = columnName(range.seriesColumns[0] - 1);
          const categoryCache = plot.categories.map((category, point) => `<c:pt idx="${point}"><c:v>${xmlEscape(category)}</c:v></c:pt>`).join("");
          const valueCache = plot.series[0].values.map((value, point) => `<c:pt idx="${point}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`).join("");
          return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${xmlEscape(plot.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>'Chart Data'!$${categoryColumn}$${range.firstSeriesRow}:$${categoryColumn}$${range.lastSeriesRow}</c:f><c:strCache><c:ptCount val="${plot.categories.length}"/>${categoryCache}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>'Chart Data'!$${valueColumn}$${range.firstSeriesRow}:$${valueColumn}$${range.lastSeriesRow}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${plot.categories.length}"/>${valueCache}</c:numCache></c:numRef></c:val></c:ser><c:dLbls><c:showVal val="1"/><c:showPercent val="1"/></c:dLbls></c:pieChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
        })()
      : chartXml(plot, chartData.ranges[plots.indexOf(plot)], kind, index),
  }));
  const renderTables = (tables: ExportTable[]) => {
    const rows: string[][] = [];
    const emphasizedCells = new Map<number, Set<number>>();
    const rowStyles = new Map<number, number>();
    const numericCells = new Map<number, Set<number>>();
    const dateCells = new Map<number, Set<number>>();
    const dateTimeCells = new Map<number, Set<number>>();
    const columnWidths: number[] = [];
    const appendRow = (row: string[], style = 0, emphasizedColumns: number[] = []) => {
      const rowIndex = rows.length;
      rows.push(row);
      if (style) rowStyles.set(rowIndex, style);
      if (emphasizedColumns.length) emphasizedCells.set(rowIndex, new Set(emphasizedColumns));
      return rowIndex;
    };
    for (const table of tables) {
      if (table.title) appendRow([table.title], 5);
      appendRow(table.headers, 6);
      (table.rows.length ? table.rows : [["No rows found."]]).forEach((row) => {
        const rowIndex = appendRow(row, 7, table.emphasizedColumns);
        if (table.numericColumns?.length && table.rows.length) numericCells.set(rowIndex, new Set(table.numericColumns));
        if (table.dateColumns?.length && table.rows.length) dateCells.set(rowIndex, new Set(table.dateColumns));
        if (table.dateTimeColumns?.length && table.rows.length) dateTimeCells.set(rowIndex, new Set(table.dateTimeColumns));
      });
      for (let index = 0; index < table.headers.length; index += 1) {
        const requestedWidth = table.columnWidths?.[index];
        const contentWidth = Math.max(
          table.headers[index]?.length ?? 0,
          ...table.rows.map((row) => String(row[index] ?? "").length),
        );
        columnWidths[index] = Math.max(
          columnWidths[index] ?? 0,
          requestedWidth ?? Math.min(52, Math.max(10, contentWidth + 2)),
        );
      }
      appendRow([]);
    }
    return worksheetXml(rows, columnWidths, emphasizedCells, rowStyles, numericCells, dateCells, dateTimeCells);
  };
  const firstAdditionalSheetIndex = chartSpecs.length ? 4 : 3;
  const additionalSheetDefinitions = additionalSheets.map((sheet, index) => ({
    ...sheet,
    sheetIndex: firstAdditionalSheetIndex + index,
    sheetId: chartSpecs.length ? 4 + index : 3 + index,
    relationshipId: chartSpecs.length ? 4 + index : 3 + index,
  }));
  const additionalSheetContentTypes = additionalSheetDefinitions
    .map(({ sheetIndex }) => `<Override PartName="/xl/worksheets/sheet${sheetIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const additionalSheetWorkbookEntries = additionalSheetDefinitions
    .map(({ name, sheetId, relationshipId }) => `<sheet name="${xmlEscape(name.slice(0, 31))}" sheetId="${sheetId}" r:id="rId${relationshipId}"/>`)
    .join("");
  const additionalSheetRelationships = additionalSheetDefinitions
    .map(({ sheetIndex, relationshipId }) => `<Relationship Id="rId${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetIndex}.xml"/>`)
    .join("");
  const files: Array<{ name: string; content: string | Buffer }> = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${chartSpecs.length ? '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}${additionalSheetContentTypes}${chartSpecs.map((_, index) => `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${chartSpecs.length ? 1 : 0}"/></bookViews><sheets><sheet name="Report" sheetId="1" r:id="rId1"/>${chartSpecs.length ? '<sheet name="Charts" sheetId="2" r:id="rId2"/>' : ""}<sheet name="Chart Data" sheetId="${chartSpecs.length ? 3 : 2}" state="hidden" r:id="${chartSpecs.length ? "rId3" : "rId2"}"/>${additionalSheetWorkbookEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${chartSpecs.length ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' : ""}<Relationship Id="${chartSpecs.length ? "rId3" : "rId2"}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>${additionalSheetRelationships}<Relationship Id="rId${chartSpecs.length ? 4 + additionalSheetDefinitions.length : 3 + additionalSheetDefinitions.length}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy hh:mm:ss"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/><color rgb="FF1F2937"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1F2937"/></font><font><b/><sz val="18"/><name val="Calibri"/><color rgb="FF111827"/></font><font><sz val="10"/><name val="Calibri"/><color rgb="FF64748B"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/><xf xfId="0" fontId="2" applyFont="1"/><xf xfId="0" fontId="3" applyFont="1"/><xf xfId="0" fontId="3" applyFont="1"/><xf xfId="0" fontId="1" fillId="3" applyFont="1" applyFill="1"/><xf xfId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf xfId="0" borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf xfId="0" fontId="1" borderId="1" applyFont="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf xfId="0" numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf xfId="0" numFmtId="165" borderId="1" applyNumberFormat="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(reportRows, columnWidths, emphasizedCells, rowStyles, numericCells, dateCells, dateTimeCells) },
    { name: "xl/worksheets/sheet2.xml", content: chartData.xml },
  ];
  if (chartSpecs.length) {
    files.push(
      { name: "xl/worksheets/sheet3.xml", content: chartWorksheetXml(chartSpecs.length, pieGrid) },
      { name: "xl/worksheets/_rels/sheet3.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` },
      { name: "xl/drawings/drawing1.xml", content: `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${drawingAnchors}</xdr:wsDr>` },
      { name: "xl/drawings/_rels/drawing1.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${chartSpecs.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`).join("")}</Relationships>` },
      ...chartFiles,
    );
  }
  additionalSheetDefinitions.forEach((sheet) => {
    files.push({
      name: `xl/worksheets/sheet${sheet.sheetIndex}.xml`,
      content: renderTables(sheet.tables),
    });
  });
  return makeZip(files);
}
