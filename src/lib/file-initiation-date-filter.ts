import type { FileRecord } from "@/lib/files-store";

export type FileInitiationDateRange = {
  fromDate: string;
  toDate: string;
};

export function isValidFileInitiationDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function getActiveFileInitiationDateRange(fromDate: string, toDate: string) {
  const from = isValidFileInitiationDate(fromDate) ? fromDate : "";
  const to = isValidFileInitiationDate(toDate) ? toDate : "";
  if (!from && !to) return undefined;
  return { fromDate: from, toDate: to } satisfies FileInitiationDateRange;
}

export function fileMatchesInitiationDateRange(
  file: FileRecord,
  range: FileInitiationDateRange | undefined,
) {
  if (!range) return true;
  if (!isValidFileInitiationDate(file.receivedDate ?? "")) return false;
  if (range.fromDate && file.receivedDate! < range.fromDate) return false;
  if (range.toDate && file.receivedDate! > range.toDate) return false;
  return true;
}

export function getFileInitiationDateSearchParams(range: FileInitiationDateRange | undefined) {
  return {
    ...(range?.fromDate ? { fileInitiationFrom: range.fromDate } : {}),
    ...(range?.toDate ? { fileInitiationTo: range.toDate } : {}),
  };
}
