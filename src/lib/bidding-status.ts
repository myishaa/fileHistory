export function isBidWindowLive(
  startDate: string | undefined,
  openingDate: string | undefined,
  today: string,
) {
  return Boolean(startDate && openingDate && startDate <= today && today <= openingDate);
}

export function isAutoTenderLive({
  refloat,
  normalStartDate,
  normalOpeningDate,
  refloatStartDate,
  refloatOpeningDate,
  today,
}: {
  refloat: boolean;
  normalStartDate: string | undefined;
  normalOpeningDate: string | undefined;
  refloatStartDate: string | undefined;
  refloatOpeningDate: string | undefined;
  today: string;
}) {
  if (refloat) return isBidWindowLive(refloatStartDate, refloatOpeningDate, today);
  return isBidWindowLive(normalStartDate, normalOpeningDate, today);
}

export function isTcecComplete(tcec: string | undefined, minutesDate: string | undefined) {
  return isYes(tcec) && Boolean(minutesDate?.trim());
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}
