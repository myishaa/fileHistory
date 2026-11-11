import type { FirmRatingConfig, FirmRatingField, SupplyOrderDetail } from "@/lib/files-store";

export const defaultFirmRatingFields: FirmRatingField[] = [
  { id: "delivery", label: "Delivery", weight: "1", minValue: "0", maxValue: "5" },
  { id: "quality", label: "Quality", weight: "1", minValue: "0", maxValue: "5" },
  {
    id: "afterSalesService",
    label: "After Sales Service",
    weight: "1",
    minValue: "0",
    maxValue: "5",
  },
];

function fieldIdFromLabel(label: string, index: number) {
  const id = label
    .trim()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/^./, (chr) => chr.toLowerCase());
  return id || `rating${index + 1}`;
}

export function createFirmRatingFieldId(fields: readonly Pick<FirmRatingField, "id">[]) {
  const usedIds = new Set(fields.map((field) => field.id));
  let id = "";
  do {
    id = `rating${crypto.randomUUID().replace(/-/g, "")}`;
  } while (usedIds.has(id));
  return id;
}

export function normalizeFirmRatingConfig(config?: FirmRatingConfig): FirmRatingConfig {
  const source = config?.fields?.length ? config.fields : defaultFirmRatingFields;
  const usedIds = new Set<string>();
  const fields = source
    .map((field, index) => {
      const label = field.label?.trim() || `Rating ${index + 1}`;
      const baseId = field.id?.trim() || fieldIdFromLabel(label, index);
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}Copy${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      const parsedWeight = Number.parseFloat(String(field.weight ?? "1"));
      const minText = field.minValue?.trim() || "0";
      const maxText = field.maxValue?.trim() || "5";
      const parsedMin = Number(minText);
      const parsedMax = Number(maxText);
      return {
        id,
        label,
        weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? String(parsedWeight) : "1",
        minValue: Number.isFinite(parsedMin) ? minText : "0",
        maxValue: Number.isFinite(parsedMax) ? maxText : "5",
      };
    })
    .filter((field) => field.label);

  return { fields: fields.length ? fields : defaultFirmRatingFields };
}

export function calculateFirmRatingScore(
  values: Record<string, string | number> | undefined,
  config?: FirmRatingConfig,
) {
  const fields = normalizeFirmRatingConfig(config).fields;
  let weightedTotal = 0;
  let hasScoredValue = false;
  for (const field of fields) {
    const rawValue = values?.[field.id];
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") continue;
    const score = Number.parseFloat(String(rawValue));
    const weight = Number.parseFloat(String(field.weight ?? "1"));
    if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += score * weight;
    hasScoredValue = true;
  }
  return hasScoredValue ? weightedTotal : undefined;
}

export function formatFirmRatingScore(score: number | undefined) {
  if (score === undefined || !Number.isFinite(score)) return "";
  return score.toFixed(2).replace(/\.?0+$/, "");
}

export function getSupplyOrderFirmRating(order: SupplyOrderDetail, config?: FirmRatingConfig) {
  return formatFirmRatingScore(calculateFirmRatingScore(order.firmRatingValues, config));
}
