import type { FileRecord, SupplyOrderDetail } from "@/lib/files-store";

type MilestoneCompletionRule = {
  aliases: string[];
  completionLabel: string;
  isApplicable?: (file: Partial<FileRecord>) => boolean;
  isComplete: (file: Partial<FileRecord>) => boolean;
};

const milestoneCompletionRules: MilestoneCompletionRule[] = [
  {
    aliases: ["Scrutiny"],
    completionLabel: "Scrutiny completion date",
    isComplete: (file) => hasFilledString(file.scrutinyCompletionDate),
  },
  {
    aliases: ["High Value"],
    completionLabel: "High value minutes date",
    isApplicable: (file) => isYes(file.highValue),
    isComplete: (file) => hasFilledString(file.highValueMinutesDate),
  },
  {
    aliases: ["Pre-TCEC"],
    completionLabel: "Pre-TCEC minutes date",
    isApplicable: (file) => isYes(file.tcec),
    isComplete: (file) => hasFilledString(file.preTcecMinutesDate),
  },
  {
    aliases: ["AD"],
    completionLabel: "AD vetting date",
    isApplicable: (file) => isYes(file.ad),
    isComplete: (file) => hasFilledString(file.adVettingDate),
  },
  {
    aliases: ["R&QA"],
    completionLabel: "R&QA approval date",
    isApplicable: (file) => isYes(file.rqa),
    isComplete: (file) => hasFilledString(file.rqaApprovalDate),
  },
  {
    aliases: ["Controlling", "Controlled"],
    completionLabel: "Control date",
    isComplete: (file) => hasFilledString(file.immsDate),
  },
  {
    aliases: ["IFA"],
    completionLabel: "IFA final date",
    isApplicable: (file) => isYes(file.ifa),
    isComplete: (file) => hasFilledString(file.ifaFinalDate),
  },
  {
    aliases: ["CFA"],
    completionLabel: "CFA approval date",
    isComplete: (file) => hasFilledString(file.cfaDate),
  },
  {
    aliases: ["Bidding"],
    completionLabel: "Bidding stage over",
    isComplete: (file) => isYes(file.biddingStageOver),
  },
  {
    aliases: ["Post-TCEC"],
    completionLabel: "Post-TCEC minutes date",
    isApplicable: (file) => isYes(file.tcec),
    isComplete: (file) => hasFilledString(file.postTcecMinutesDate),
  },
  {
    aliases: ["CNC"],
    completionLabel: "CNC approval date",
    isApplicable: (file) => isYes(file.tcec),
    isComplete: (file) => hasFilledString(file.cncApprovalDate),
  },
  {
    aliases: ["Supply Order"],
    completionLabel: "S.O. date",
    isComplete: (file) => fileSupplyOrders(file).some((order) => hasFilledString(order.soDate)),
  },
  {
    aliases: ["Bank Guarantee"],
    completionLabel: "BG validity date",
    isApplicable: (file) => isYes(file.bg),
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.bgValidityDate)),
  },
  {
    aliases: ["Delivery"],
    completionLabel: "Material receipt date",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.materialReceiptDate)),
  },
  {
    aliases: ["IR Preparation"],
    completionLabel: "IR Preparation",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.irPreparationDate)),
  },
  {
    aliases: ["IR Receipt"],
    completionLabel: "IR Receipt",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.irReceiptDate)),
  },
  {
    aliases: ["Bill preparation"],
    completionLabel: "Bill preparation",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.billPreparationDate)),
  },
  {
    aliases: ["Bill sent for payment"],
    completionLabel: "Bill sent for payment",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.billSentForPaymentDate)),
  },
  {
    aliases: ["Payment"],
    completionLabel: "Payment date",
    isComplete: (file) =>
      fileSupplyOrders(file).some((order) => hasFilledString(order.paymentDate)),
  },
];

export function validateMilestoneCompletionConsistency(
  file: Partial<FileRecord>,
  configuredMilestones: string[],
) {
  const configured = configuredMilestones.length
    ? configuredMilestones
    : milestoneCompletionRules.flatMap((rule) => rule.aliases.slice(0, 1));
  const completed = new Set((file.completedMilestones ?? []).map(normalizeMilestoneName));
  const currentMilestone = normalizeMilestoneName(file.currentMilestone ?? "");
  const errors: string[] = [];
  let hasAnyCompletionValue = false;
  let hasIncompleteApplicableStage = false;

  for (const milestone of configured) {
    const rule = getMilestoneCompletionRule(milestone);
    if (!rule || (rule.isApplicable && !rule.isApplicable(file))) continue;

    const stageLabel = rule.aliases[0];
    const manuallyCompleted = rule.aliases.some((alias) =>
      completed.has(normalizeMilestoneName(alias)),
    );
    const hasCompletionValue = rule.isComplete(file);
    hasAnyCompletionValue ||= hasCompletionValue;
    hasIncompleteApplicableStage ||= !hasCompletionValue;

    if (hasCompletionValue && !manuallyCompleted) {
      errors.push(
        `${rule.completionLabel} is filled, but ${stageLabel} is not marked completed manually.`,
      );
    }
    if (manuallyCompleted && !hasCompletionValue) {
      errors.push(
        `${stageLabel} is marked completed manually, but ${rule.completionLabel} is missing.`,
      );
    }
  }

  if (hasAnyCompletionValue && hasIncompleteApplicableStage && !currentMilestone) {
    errors.push("Current milestone is not selected manually.");
  }

  return errors;
}

function getMilestoneCompletionRule(milestone: string) {
  const key = normalizeMilestoneName(milestone);
  return milestoneCompletionRules.find((rule) =>
    rule.aliases.some((alias) => normalizeMilestoneName(alias) === key),
  );
}

function fileSupplyOrders(file: Partial<FileRecord>) {
  const rows =
    file.supplyOrders
      ?.map((row) => ({ ...row }))
      .filter((row) => Object.values(row).some((value) => hasFilledString(String(value ?? "")))) ??
    [];
  if (rows.length) return rows;

  const legacy: SupplyOrderDetail = {
    soDate: file.soDate,
    bgValidityDate: file.bgValidityDate,
    materialReceiptDate: file.materialReceiptDate,
    irPreparationDate: file.irPreparationDate,
    irReceiptDate: file.irReceiptDate,
    billPreparationDate: file.billPreparationDate,
    billSentForPaymentDate: file.billSentForPaymentDate,
    paymentDate: file.paymentDate,
    soCancelledDate: file.soCancelledDate,
  };
  return Object.values(legacy).some((value) => hasFilledString(String(value ?? "")))
    ? [legacy]
    : [];
}

function normalizeMilestoneName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}
