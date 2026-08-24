import type { FirmRatingConfig, FirmRatingField, SupplyOrderDetail } from "@/lib/files-store";

export const defaultFirmRatingFields: FirmRatingField[] = [
  { id: "delivery", label: "Delivery", weight: "1" },
  { id: "quality", label: "Quality", weight: "1" },
  { id: "afterSalesService", label: "After Sales Service", weight: "1" },
];

function fieldIdFromLabel(label: string, index: number) {
  const id = label
    .trim()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/^./, (chr) => chr.toLowerCase());
  return id || `rating${index + 1}`;
}

export function normalizeFirmRatingConfig(config?: FirmRatingConfig): FirmRatingConfig {
  const source = config?.fields?.length ? config.fields : defaultFirmRatingFields;
  const fields = source
    .map((field, index) => {
      const label = field.label?.trim() || `Rating ${index + 1}`;
      const id = field.id?.trim() || fieldIdFromLabel(label, index);
      const parsedWeight = Number.parseFloat(String(field.weight ?? "1"));
      return {
        id,
        label,
        weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? String(parsedWeight) : "1",
      };
    })
    .filter((field) => field.label);

  return { fields: fields.length ? fields : defaultFirmRatingFields };
}

export function calculateFirmRatingScore(
  values: Record<string, string> | undefined,
  config?: FirmRatingConfig,
) {
  const fields = normalizeFirmRatingConfig(config).fields;
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const field of fields) {
    const rawValue = values?.[field.id];
    if (rawValue === undefined || rawValue === "") continue;
    const score = Number.parseFloat(String(rawValue));
    const weight = Number.parseFloat(String(field.weight ?? "1"));
    if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += score * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : undefined;
}

export function formatFirmRatingScore(score: number | undefined) {
  if (score === undefined || !Number.isFinite(score)) return "";
  return score.toFixed(2).replace(/\.?0+$/, "");
}

export function getSupplyOrderFirmRating(order: SupplyOrderDetail, config?: FirmRatingConfig) {
  return formatFirmRatingScore(calculateFirmRatingScore(order.firmRatingValues, config));
}
