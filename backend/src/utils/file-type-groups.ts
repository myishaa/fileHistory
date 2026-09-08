import type { FileRecord } from "../types.js";

export type FileTypeGroup = "goodsServices" | "contract";

export type FileTypeGroupSetting = {
  fileType: string;
  group: FileTypeGroup;
};

export function normalizeFileTypeGroup(value: unknown): FileTypeGroup {
  return value === "contract" ? "contract" : "goodsServices";
}

export function getDefaultFileTypeGroup(fileType: string | undefined): FileTypeGroup {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return normalized === "amc" ||
    normalized === "mpc" ||
    normalized === "cars" ||
    normalized === "capsi" ||
    normalized === "o&m"
    ? "contract"
    : "goodsServices";
}

export function normalizeFileTypeGroups(
  groups: unknown,
  fileTypes: string[] | undefined,
): FileTypeGroupSetting[] {
  const rawGroups = Array.isArray(groups) ? groups : [];
  const configured = new Map<string, FileTypeGroup>();
  for (const entry of rawGroups) {
    if (!entry || typeof entry !== "object") continue;
    const fileType = "fileType" in entry ? String(entry.fileType ?? "").trim() : "";
    if (!fileType) continue;
    configured.set(
      fileType.toLowerCase(),
      normalizeFileTypeGroup("group" in entry ? entry.group : undefined),
    );
  }
  const seen = new Set<string>();
  return (fileTypes ?? [])
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      if (!fileType || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((fileType) => ({
      fileType,
      group: configured.get(fileType.toLowerCase()) ?? getDefaultFileTypeGroup(fileType),
    }));
}

export function isContractFileType(file: {
  fileType?: string;
  fileTypeGroup?: FileTypeGroup | string;
}): boolean {
  return (
    normalizeFileTypeGroup(file.fileTypeGroup ?? getDefaultFileTypeGroup(file.fileType)) ===
    "contract"
  );
}

export function isDeliveryInspectionApplicableByGroup(
  file: Pick<FileRecord, "fileType" | "fileTypeGroup" | "ir">,
): boolean {
  return !isNo(file.ir) && !isContractFileType(file);
}

export function isBiddingApplicableForFile(
  file: Pick<FileRecord, "mode" | "fileType"> & Partial<Pick<FileRecord, "gem" | "gemBiddingMode">>,
): boolean {
  const mode = String(file.mode ?? "")
    .trim()
    .toUpperCase();
  const fileType = String(file.fileType ?? "")
    .trim()
    .toLowerCase();
  const gem = String(file.gem ?? "")
    .trim()
    .toLowerCase();
  const gemBiddingMode = String(file.gemBiddingMode ?? "")
    .trim()
    .toLowerCase();
  return (
    mode !== "LPC" &&
    fileType !== "cars" &&
    fileType !== "capsi" &&
    !(gem === "yes" && gemBiddingMode === "comparison")
  );
}

function isNo(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "no"
  );
}
