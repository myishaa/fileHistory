export const addEditRibbonFieldOptions = [
  { key: "imms", label: "Control No." },
  { key: "indentor", label: "Indentor" },
  { key: "year", label: "Demand initiation year" },
  { key: "uniqueCode", label: "Unique code" },
  { key: "division", label: "Division" },
  { key: "fileTypeGroup", label: "File category / workflow group" },
  { key: "mode", label: "Procurement mode" },
  { key: "demandValue", label: "Demand value" },
  { key: "valueCapital", label: "Capital value" },
  { key: "valueRevenue", label: "Revenue value" },
  { key: "latestSupplyOrderNo", label: "Latest S.O. number" },
  { key: "latestFirmName", label: "Latest firm name" },
] as const;

export type AddEditRibbonFieldKey = (typeof addEditRibbonFieldOptions)[number]["key"];

export const defaultAddEditRibbonFields: AddEditRibbonFieldKey[] = ["imms", "indentor"];

const allowedAddEditRibbonFields = new Set<string>(
  addEditRibbonFieldOptions.map((option) => option.key),
);

export function normalizeAddEditRibbonFields(value: unknown): AddEditRibbonFieldKey[] {
  if (!Array.isArray(value)) return defaultAddEditRibbonFields;
  const normalized = value.filter(
    (field): field is AddEditRibbonFieldKey =>
      typeof field === "string" && allowedAddEditRibbonFields.has(field),
  );
  const unique = Array.from(new Set(normalized)).slice(0, 2);
  return unique.length === 2 ? unique : defaultAddEditRibbonFields;
}
