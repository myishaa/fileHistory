export function isPlacedSupplyOrderMissingFirmName(
  soDate: string | undefined,
  firmName: string | undefined,
) {
  return Boolean(soDate?.trim()) && !firmName?.trim();
}
