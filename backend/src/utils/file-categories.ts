export const allFileCategoryKeys = ["goodsServices", "amc", "mpc", "cars", "om"] as const;

export type FixedFileCategoryKey = (typeof allFileCategoryKeys)[number];
export type FileCategoryKey = FixedFileCategoryKey | `fileType:${string}`;

const fileCategoryKeySet = new Set<string>(allFileCategoryKeys);
const fixedFileCategoryByType: Record<string, FixedFileCategoryKey> = {
  amc: "amc",
  mpc: "mpc",
  cars: "cars",
  "o&m": "om",
};
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

export function matchesFileCategorySelection(
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

export function getFileCategorySqlCondition(categories: FileCategoryKey[], alias = "f") {
  if (categories.length === 0) return "false";
  const categorySet = new Set(categories);
  const fileTypeSql = `lower(trim(coalesce(${alias}.file_type, '')))`;
  const predicates: string[] = [];
  if (categorySet.has("goodsServices")) {
    predicates.push(`${fileTypeSql} in ('', 'goods & services')`);
  }
  if (categorySet.has("amc")) predicates.push(`${fileTypeSql} = 'amc'`);
  if (categorySet.has("mpc")) predicates.push(`${fileTypeSql} = 'mpc'`);
  if (categorySet.has("cars")) predicates.push(`${fileTypeSql} = 'cars'`);
  if (categorySet.has("om")) predicates.push(`${fileTypeSql} = 'o&m'`);
  categories
    .map(getFileTypeFromCategoryKey)
    .filter(Boolean)
    .forEach((fileType) => {
      predicates.push(`${fileTypeSql} = '${fileType.toLowerCase().replaceAll("'", "''")}'`);
    });
  return predicates.length ? `(${predicates.join(" or ")})` : "false";
}
