export const fileCategoryOptions = [
  { key: "goodsServices", label: "Goods & Services" },
  { key: "amc", label: "AMC" },
  { key: "mpc", label: "MPC" },
  { key: "cars", label: "CARS" },
  { key: "om", label: "O&M" },
] as const;

export type FixedFileCategoryKey = (typeof fileCategoryOptions)[number]["key"];
export type FileCategoryKey = FixedFileCategoryKey | `fileType:${string}`;
export type FileCategoryOption = { key: FileCategoryKey; label: string };

export const allFileCategoryKeys: FileCategoryKey[] = fileCategoryOptions.map(
  (option) => option.key,
);

const fileCategoryKeySet = new Set<string>(allFileCategoryKeys);
const fixedFileCategoryByType: Record<string, FixedFileCategoryKey> = {
  amc: "amc",
  mpc: "mpc",
  cars: "cars",
  "o&m": "om",
};
const defaultFileTypeLabels = new Set(["goods & services", "amc", "mpc", "cars", "o&m"]);
const goodsServicesFileTypes = new Set(["", "goods & services"]);

export function getFileTypeCategoryKey(fileType: string) {
  return `fileType:${encodeURIComponent(fileType.trim())}` as const;
}

function getFileTypeFromCategoryKey(category: string) {
  if (!category.startsWith("fileType:")) return "";
  try {
    return decodeURIComponent(category.slice("fileType:".length)).trim();
  } catch {
    return category.slice("fileType:".length).trim();
  }
}

export function getFileCategoryOptions(fileTypes: string[] | undefined): FileCategoryOption[] {
  const customOptions = (fileTypes ?? [])
    .map((fileType) => fileType.trim())
    .filter((fileType) => fileType && !defaultFileTypeLabels.has(fileType.toLowerCase()))
    .map((fileType) => ({ key: getFileTypeCategoryKey(fileType), label: fileType }));
  return [...fileCategoryOptions, ...customOptions];
}

export function getAllFileCategoryKeys(fileTypes: string[] | undefined): FileCategoryKey[] {
  return getFileCategoryOptions(fileTypes).map((option) => option.key);
}

export function normalizeFileCategories(values: string[] | undefined): FileCategoryKey[] {
  if (!values) return [...allFileCategoryKeys];
  const seen = new Set<FileCategoryKey>();
  values.forEach((value) => {
    const key = value.trim();
    if (fileCategoryKeySet.has(key)) {
      seen.add(key as FileCategoryKey);
      return;
    }
    const fileType = getFileTypeFromCategoryKey(key);
    if (fileType) {
      seen.add(getFileTypeCategoryKey(fileType));
    }
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
  return [
    ...allFileCategoryKeys.filter((key) => seen.has(key)),
    ...Array.from(seen).filter((key) => !fileCategoryKeySet.has(key)),
  ];
}

export function getVisibleFileCategoryKeys(
  values: string[] | null | undefined,
  fileTypes?: string[],
) {
  return Array.isArray(values)
    ? normalizeFileCategories(values)
    : getAllFileCategoryKeys(fileTypes);
}

export function getVisibleFileCategoryOptions(
  values: string[] | null | undefined,
  fileTypes?: string[],
) {
  const options = getFileCategoryOptions(fileTypes);
  const visibleKeys = new Set(getVisibleFileCategoryKeys(values, fileTypes));
  return options.filter((option) => visibleKeys.has(option.key));
}

export function serializeFileCategories(values: FileCategoryKey[]) {
  return values.length ? values.join(",") : "__none__";
}

export function fileMatchesCategory(
  file: { fileType?: string; fileTypeGroup?: string },
  categories: FileCategoryKey[],
) {
  const categorySet = new Set(categories);
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  const customCategory = getFileTypeCategoryKey(file.fileType ?? "");
  if (categorySet.has(customCategory)) return true;
  const fixedCategory = fixedFileCategoryByType[fileType];
  if (fixedCategory) return categorySet.has(fixedCategory);
  if (goodsServicesFileTypes.has(fileType)) return categorySet.has("goodsServices");
  return false;
}

export function filterFilesByCategory<T extends { fileType?: string; fileTypeGroup?: string }>(
  files: T[],
  categories: FileCategoryKey[],
) {
  return files.filter((file) => fileMatchesCategory(file, categories));
}
