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
    const requestedFileName = optionalString(body.fileName);
    const extension = format === "excel" ? "xls" : "pdf";
    const fileName = requestedFileName?.endsWith(`.${extension}`)
      ? requestedFileName
      : getExportFileName(requestedFileName || title, extension);

    if (format === "excel") {
      const workbook = renderExcelDocument({ title, subtitle, description, tables });
      response.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.send(workbook);
      return;
    }

    const pdf = renderPdfDocument({ title, subtitle, description, tables });
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
      rows: record.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new HttpError(400, `tables[${index}].rows[${rowIndex}] must be an array.`);
        }
        return row.map((cell) => String(cell ?? ""));
      }),
    };
  });
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}
