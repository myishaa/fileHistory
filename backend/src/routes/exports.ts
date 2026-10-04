import { Router } from "express";
import {
  getExportFileName,
  renderExcelDocument,
  renderPdfDocument,
} from "../utils/export-files.js";
import { requireAuth, type AuthRequest } from "../utils/auth.js";
import { asyncHandler, HttpError, requireObjectBody, requireString } from "../utils/http.js";

export const exportsRouter = Router();

type ExportFormat = "excel" | "pdf";

exportsRouter.post(
  "/table",
  asyncHandler(async (request, response) => {
    requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const format = requireExportFormat(body.format);
    const title = requireString(body.title, "title").trim();
    const subtitle = optionalString(body.subtitle);
    const description = optionalString(body.description);
    const tables = requireTables(body.tables);
    const plot = requirePlot(body.plot);
    const plots = requirePlots(body.plots);
    const requestedFileName = optionalString(body.fileName);
    const extension = format === "excel" ? "xlsx" : "pdf";
    const requestedExtension = requestedFileName?.match(/\.(?:xlsx|xls|pdf)$/i)?.[0];
    const fileName = requestedExtension?.toLowerCase() === `.${extension}`
      ? requestedFileName
      : getExportFileName(requestedFileName?.replace(/\.(?:xlsx|xls|pdf)$/i, "") || title, extension);

    if (format === "excel") {
      const workbook = renderExcelDocument({ title, subtitle, description, tables, plot, plots });
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.send(workbook);
      return;
    }

    const pdf = renderPdfDocument({ title, subtitle, description, tables, plot, plots });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    response.send(pdf);
  }),
);

function requireExportFormat(value: unknown): ExportFormat {
  if (value === "excel" || value === "pdf") return value;
  throw new HttpError(400, "format must be excel or pdf.");
}

function requireTables(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "At least one export table is required.");
  }

  return value.map((table, index) => {
    if (!table || typeof table !== "object") {
      throw new HttpError(400, `tables[${index}] must be an object.`);
    }
    const record = table as Record<string, unknown>;
    if (!Array.isArray(record.headers) || !record.headers.length) {
      throw new HttpError(400, `tables[${index}].headers must be a non-empty array.`);
    }
    if (!Array.isArray(record.rows)) {
      throw new HttpError(400, `tables[${index}].rows must be an array.`);
    }

    return {
      title: optionalString(record.title),
      headers: record.headers.map((header) => String(header ?? "")),
      columnWidths: optionalColumnWidths(record.columnWidths, record.headers.length),
      emphasizedColumns: optionalColumnIndexes(record.emphasizedColumns, record.headers.length),
      rows: record.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new HttpError(400, `tables[${index}].rows[${rowIndex}] must be an array.`);
        }
        return row.map((cell) => String(cell ?? ""));
      }),
    };
  });
}

function requirePlot(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object") throw new HttpError(400, "plot must be an object.");
  const record = value as Record<string, unknown>;
  if (record.kind !== "bar" && record.kind !== "line" && record.kind !== "pie") {
    throw new HttpError(400, "plot.kind must be bar, line, or pie.");
  }
  if (!Array.isArray(record.categories) || !Array.isArray(record.series)) {
    throw new HttpError(400, "plot requires categories and series arrays.");
  }
  const categories = record.categories.map(String);
  const series = record.series.map((item, index) => {
    if (!item || typeof item !== "object") throw new HttpError(400, `plot.series[${index}] must be an object.`);
    const candidate = item as Record<string, unknown>;
    if (!Array.isArray(candidate.values) || candidate.values.length !== categories.length) {
      throw new HttpError(400, `plot.series[${index}].values must match the category count.`);
    }
    const values = candidate.values.map(Number);
    if (values.some((number) => !Number.isFinite(number))) {
      throw new HttpError(400, `plot.series[${index}].values must be finite numbers.`);
    }
    return {
      name: String(candidate.name ?? `Series ${index + 1}`),
      values,
      color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : undefined,
    };
  });
  return {
    kind: record.kind,
    title: String(record.title ?? "Chart"),
    measure: String(record.measure ?? "Value"),
    unit: optionalString(record.unit),
    xAxisTitle: optionalString(record.xAxisTitle),
    yAxisTitle: optionalString(record.yAxisTitle),
    expandedYears: Array.isArray(record.expandedYears) ? record.expandedYears.map(String) : undefined,
    compactBars: record.compactBars === true,
    stackedBars: record.stackedBars === true,
    categories,
    series,
  } as const;
}

function requirePlots(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, "plots must be an array.");
  return value
    .map((plot) => requirePlot(plot))
    .filter((plot): plot is NonNullable<typeof plot> => plot !== undefined);
}

function optionalColumnWidths(value: unknown, expectedCount: number) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new HttpError(400, "columnWidths must match the number of table headers.");
  }
  const widths = value.map((item) => Number(item));
  if (widths.some((width) => !Number.isFinite(width) || width <= 0)) {
    throw new HttpError(400, "columnWidths must contain positive numbers.");
  }
  return widths;
}

function optionalColumnIndexes(value: unknown, expectedCount: number) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new HttpError(400, "emphasizedColumns must be an array of column indexes.");
  }
  const indexes = value.map((item) => Number(item));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= expectedCount)) {
    throw new HttpError(400, "emphasizedColumns contains an invalid column index.");
  }
  return Array.from(new Set(indexes));
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}
