const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type ExportFormat = "excel" | "pdf";

export type ExportTable = {
  title?: string;
  headers: string[];
  rows: Array<Array<string | number | undefined>>;
};

export type ExportPayload = {
  format: ExportFormat;
  title: string;
  subtitle?: string;
  description?: string;
  fileName?: string;
  tables: ExportTable[];
};

async function downloadExportResponse(
  response: Response,
  fallbackFileName: string,
  defaultError: string,
) {
  if (!response.ok) {
    let message = `${defaultError}: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Keep the status-based message when the server response is not JSON.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackFileName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadBackendExport(payload: ExportPayload) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/exports/table`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await downloadExportResponse(
      response,
      payload.fileName ??
        `${getExportFileName(payload.title)}.${payload.format === "excel" ? "xls" : "pdf"}`,
      "Export failed",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    window.alert(message);
    console.error(error);
  }
}

export type FileSearchExportColumn = {
  key: string;
  label: string;
};

export type FileSearchExportPayload = {
  format: ExportFormat;
  title: string;
  columns: FileSearchExportColumn[];
  query: Record<string, string>;
};

export async function downloadBackendFileSearchExport(payload: FileSearchExportPayload) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/files/export/search`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await downloadExportResponse(
      response,
      `${getExportFileName(payload.title)}.${payload.format === "excel" ? "xls" : "pdf"}`,
      "File export failed",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "File export failed.";
    window.alert(message);
    console.error(error);
  }
}

export function getExportFileName(title: string) {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export"
  );
}
