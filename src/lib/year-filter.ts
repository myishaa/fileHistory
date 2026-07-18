import type { FileRecord } from "@/lib/files-store";

export const ALL_ACTIVE_FILES_YEAR = "__all_active_files__";

export function isAllActiveFilesYear(year: string | undefined) {
  return year === ALL_ACTIVE_FILES_YEAR;
}

export function normalizeFinancialYearLabel(year: string | undefined) {
  const label = year?.trim() ?? "";
  if (!label || isAllActiveFilesYear(label)) return label;

  const fullYearMatch = label.match(/^(\d{4})-(\d{4})$/);
  if (fullYearMatch) return `${fullYearMatch[1]}-${fullYearMatch[2].slice(-2)}`;

  const startYearMatch = label.match(/^(\d{4})$/);
  if (!startYearMatch) return label;

  const startYear = Number(startYearMatch[1]);
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

export function displayFinancialYearLabel(year: string | undefined) {
  const label = normalizeFinancialYearLabel(year);
  if (!label) return "";
  if (isAllActiveFilesYear(label)) return "All active files";
  return label;
}

export function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function isPaymentCompletedFile(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some((milestone) => normalizeMilestoneName(milestone) === "payment"),
  );
}

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

export function isCancelledFile(
  file: Pick<FileRecord, "demandCancelled" | "soCancelled" | "supplyOrders">,
) {
  if (isYes(file.demandCancelled)) return true;
  const supplyOrders = file.supplyOrders ?? [];
  if (supplyOrders.length === 0) return isYes(file.soCancelled);
  return supplyOrders.every((order) => isYes(order.soCancelled));
}

export function isInactiveFile(
  file: Pick<
    FileRecord,
    "completedMilestones" | "demandCancelled" | "soCancelled" | "supplyOrders"
  >,
) {
  return isPaymentCompletedFile(file) || isCancelledFile(file);
}

export function isFileVisibleForYear(
  file: Pick<
    FileRecord,
    | "year"
    | "activeYears"
    | "completedMilestones"
    | "demandCancelled"
    | "soCancelled"
    | "supplyOrders"
  >,
  year: string | undefined,
) {
  if (!year) return true;
  if (isAllActiveFilesYear(year)) return !isInactiveFile(file);
  return file.year === year || file.activeYears?.includes(year);
}
