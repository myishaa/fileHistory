import type { FileRecord } from "@/lib/files-store";

export const ALL_ACTIVE_FILES_YEAR = "__all_active_files__";
export const ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR = "__active_plus_current_fy_closed__";

export function isAllActiveFilesYear(year: string | undefined) {
  return year === ALL_ACTIVE_FILES_YEAR;
}

export function isActivePlusCurrentFyClosedYear(year: string | undefined) {
  return year === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function readFinancialYearStart(year: string | undefined) {
  const match = (year ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function isDateInFinancialYear(date: string | undefined, financialYear: string | undefined) {
  if (!date) return false;
  const startYear = readFinancialYearStart(financialYear);
  if (!startYear) return false;
  return date >= `${startYear}-04-01` && date <= `${startYear + 1}-03-31`;
}

export function normalizeFinancialYearLabel(year: string | undefined) {
  const label = year?.trim() ?? "";
  if (!label || isAllActiveFilesYear(label) || isActivePlusCurrentFyClosedYear(label)) return label;

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
  if (isActivePlusCurrentFyClosedYear(label)) return "Active + current FY closed";
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

export function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) => normalizeMilestoneName(milestone) === "fileclosed",
    ),
  );
}

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

export function isCancelledFile(
  file: Pick<FileRecord, "demandCancelled" | "soCancelled" | "shortclosure" | "supplyOrders">,
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
  return isFileClosed(file) || isCancelledFile(file);
}

export function isFileVisibleForYear(
  file: Pick<
    FileRecord,
    | "year"
    | "activeYears"
    | "completedMilestones"
    | "fileClosureDate"
    | "demandCancelled"
    | "soCancelled"
    | "supplyOrders"
  >,
  year: string | undefined,
  currentFinancialYear?: string,
) {
  if (!year) return true;
  if (isAllActiveFilesYear(year)) return !isInactiveFile(file);
  if (isActivePlusCurrentFyClosedYear(year)) {
    return (
      !isInactiveFile(file) || isDateInFinancialYear(file.fileClosureDate, currentFinancialYear)
    );
  }
  return file.year === year || file.activeYears?.includes(year);
}
