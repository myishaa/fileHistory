import type { FileRecord } from "@/lib/files-store";

export const fileCategoryOptions = [
  { key: "goodsServices", label: "Goods & Services" },
  { key: "amc", label: "AMC" },
  { key: "mpc", label: "MPC" },
  { key: "cars", label: "CARS" },
  { key: "om", label: "O&M" },
] as const;

export type FileCategoryKey = (typeof fileCategoryOptions)[number]["key"];

export const allFileCategoryKeys = fileCategoryOptions.map((option) => option.key);

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

export function getVisibleFileCategoryKeys(values: string[] | null | undefined) {
  return Array.isArray(values) ? normalizeFileCategories(values) : [...allFileCategoryKeys];
}

export function getVisibleFileCategoryOptions(values: string[] | null | undefined) {
  const visibleKeys = new Set(getVisibleFileCategoryKeys(values));
  return fileCategoryOptions.filter((option) => visibleKeys.has(option.key));
}

export function serializeFileCategories(values: FileCategoryKey[]) {
  return values.length ? values.join(",") : "__none__";
}

export function fileMatchesCategory(file: Pick<FileRecord, "fileType" | "mode">, categories: FileCategoryKey[]) {
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

export function filterFilesByCategory<T extends Pick<FileRecord, "fileType" | "mode">>(
  files: T[],
  categories: FileCategoryKey[],
) {
  return files.filter((file) => fileMatchesCategory(file, categories));
}
