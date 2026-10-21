type BgCoverageFields = {
  bgCoverageType?: string;
  psbApplicable?: string;
  psbBgNo?: string;
  psbBgAmount?: string;
  psbBgReceivedDate?: string;
  psbBgValidityDate?: string;
  psbBgReturnDate?: string;
  pwbBgNo?: string;
  pwbBgAmount?: string;
  pwbBgReceivedDate?: string;
  pwbBgValidityDate?: string;
  pwbBgReturnDate?: string;
  combinedBgNo?: string;
  combinedBgAmount?: string;
  combinedBgReceivedDate?: string;
  combinedBgValidityDate?: string;
  combinedBgReturnDate?: string;
  warrantyPeriodDate?: string;
};

const psbFields = [
  ["psbBgNo", "PSB BG number"],
  ["psbBgAmount", "PSB BG amount"],
  ["psbBgReceivedDate", "PSB BG received date"],
  ["psbBgValidityDate", "PSB BG validity date"],
  ["psbBgReturnDate", "PSB BG return date"],
] as const;

const pwbFields = [
  ["pwbBgNo", "PWB BG number"],
  ["pwbBgAmount", "PWB BG amount"],
  ["pwbBgReceivedDate", "PWB BG received date"],
  ["pwbBgValidityDate", "PWB BG validity date"],
  ["pwbBgReturnDate", "PWB BG return date"],
] as const;

const combinedFields = [
  ["combinedBgNo", "Combined BG number"],
  ["combinedBgAmount", "Combined BG amount"],
  ["combinedBgReceivedDate", "Combined BG received date"],
  ["combinedBgValidityDate", "Combined BG validity date"],
  ["combinedBgReturnDate", "Combined BG return date"],
] as const;

const allBgFields = [
  ...psbFields,
  ...pwbFields,
  ...combinedFields,
  ["warrantyPeriodDate", "Warranty period date"],
] as const;

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

export function clearInapplicableBgCoverageFields<T extends BgCoverageFields>(order: T): T {
  const coverage = order.bgCoverageType ?? "None";
  const psbApplies =
    order.psbApplicable === "Yes" &&
    (coverage === "PSB" || coverage === "PSB and PWB separately");
  const pwbApplies = coverage === "PWB" || coverage === "PSB and PWB separately";
  const combinedApplies = coverage === "PSB+PWB";

  const next = { ...order };
  if (!psbApplies) {
    for (const [key] of psbFields) next[key] = "";
  }
  if (!pwbApplies) {
    for (const [key] of pwbFields) next[key] = "";
  }
  if (!combinedApplies) {
    for (const [key] of combinedFields) next[key] = "";
  }
  if (!pwbApplies && !combinedApplies) next.warrantyPeriodDate = "";
  return next;
}

export function getClearedBgCoverageFieldLabels(
  before: BgCoverageFields,
  after: BgCoverageFields,
) {
  return allBgFields
    .filter(([key]) => hasValue(before[key]) && !hasValue(after[key]))
    .map(([, label]) => label);
}
