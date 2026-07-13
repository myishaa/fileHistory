import type { FileRecord } from "../types.js";

export const allFileCategoryKeys = ["goodsServices", "amc", "mpc", "cars", "om"] as const;

export type FileCategoryKey = (typeof allFileCategoryKeys)[number];

const fileCategoryKeySet = new Set<string>(allFileCategoryKeys);

export function normalizeFileCategories(values: string[] | undefined): FileCategoryKey[] {
  if (!values) return [...allFileCategoryKeys];
  const seen = new Set<FileCategoryKey>();
  values.forEach((value) => {
    const key = value.trim();
    if (fileCategoryKeySet.has(key)) seen.add(key as FileCategoryKey);
  });
  if (
    seen.has("goodsServices") &&
    seen.has("amc") &&
    seen.has("mpc") &&
    seen.has("cars") &&
    !seen.has("om")
  ) {
    seen.add("om");
  }
  return allFileCategoryKeys.filter((key) => seen.has(key));
}

export function matchesFileCategorySelection(
  file: Pick<FileRecord, "fileType" | "mode">,
  categories: FileCategoryKey[],
) {
  const categorySet = new Set(categories);
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  if (categorySet.has("cars") && fileType === "cars") return true;
  if (categorySet.has("amc") && fileType === "amc") return true;
  if (categorySet.has("mpc") && fileType === "mpc") return true;
  if (categorySet.has("om") && fileType === "o&m") return true;
  if (
    categorySet.has("goodsServices") &&
    fileType !== "amc" &&
    fileType !== "mpc" &&
    fileType !== "cars" &&
    fileType !== "o&m"
  ) {
    return true;
  }
  return false;
}
