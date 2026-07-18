import type { FileRecord, StageDeliveryDetail, SupplyOrderDetail } from "@/lib/files-store";
import { fileSupplyOrders as normalizedFileSupplyOrders } from "@/lib/effective-deliveries";

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
    isApplicable: (file) => isDeliveryInspectionApplicable(file),
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "materialReceiptDate"),
  },
  {
    aliases: ["IR Preparation"],
    completionLabel: "IR Preparation",
    isApplicable: (file) => isYes(file.ir),
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "irPreparationDate"),
  },
  {
    aliases: ["IR Receipt"],
    completionLabel: "IR Receipt",
    isApplicable: (file) => isYes(file.ir),
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "irReceiptDate"),
  },
  {
    aliases: ["Bill preparation"],
    completionLabel: "Bill preparation",
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "billPreparationDate"),
  },
  {
    aliases: ["Bill sent for payment"],
    completionLabel: "Bill sent for payment",
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "billSentForPaymentDate"),
  },
  {
    aliases: ["Payment"],
    completionLabel: "Payment date",
    isComplete: (file) =>
      areApplicableSupplyOrdersComplete(file, "paymentDate"),
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
      const progress = getMilestoneProgress(file, stageLabel);
      errors.push(
        progress
          ? `${stageLabel} is marked completed manually, but only ${progress.completed} of ${progress.total} stage(s) have ${rule.completionLabel}.`
          : `${stageLabel} is marked completed manually, but ${rule.completionLabel} is missing.`,
      );
    }
  }

  if (hasAnyCompletionValue && hasIncompleteApplicableStage && !currentMilestone) {
    errors.push("Current milestone is not selected manually.");
  }

  return errors;
}

export function getMilestoneValidationTarget(errors: string[], configuredMilestones: string[]) {
  const configured = configuredMilestones.length
    ? configuredMilestones
    : milestoneCompletionRules.flatMap((rule) => rule.aliases.slice(0, 1));
  const firstError = errors[0] ?? "";
  const matchingRule = milestoneCompletionRules.find((rule) =>
    [rule.completionLabel, ...rule.aliases].some((label) =>
      firstError.toLowerCase().includes(label.toLowerCase()),
    ),
  );
  if (!matchingRule) return undefined;
  const match = configured.find((milestone) =>
    matchingRule.aliases.some(
      (alias) => normalizeMilestoneName(alias) === normalizeMilestoneName(milestone),
    ),
  );
  return match ?? matchingRule.aliases[0];
}

function getMilestoneCompletionRule(milestone: string) {
  const key = normalizeMilestoneName(milestone);
  return milestoneCompletionRules.find((rule) =>
    rule.aliases.some((alias) => normalizeMilestoneName(alias) === key),
  );
}

function fileSupplyOrders(file: Partial<FileRecord>) {
  return normalizedFileSupplyOrders(file as FileRecord);
}

function areApplicableSupplyOrdersComplete(
  file: Partial<FileRecord>,
  key:
    | "materialReceiptDate"
    | "irPreparationDate"
    | "irReceiptDate"
    | "billPreparationDate"
    | "billSentForPaymentDate"
    | "paymentDate",
) {
  if (isPaymentFieldKey(key)) return areApplicablePaymentFieldsComplete(file, key);

  const orders = fileSupplyOrders(file).filter((order) => hasFilledString(order.soDate));
  if (!orders.length) return false;
  return orders.every((order) => hasFilledString(order[key]));
}

function areApplicablePaymentFieldsComplete(
  file: Partial<FileRecord>,
  key: "billPreparationDate" | "billSentForPaymentDate" | "paymentDate",
) {
  const rawOrders = (file.supplyOrders ?? []).filter((order) => hasFilledString(order.soDate));
  if (!rawOrders.length) return false;

  return rawOrders.every((order) => {
    if (isYes(order.stageDelivery) && isYes(order.stagePayment)) {
      const stages = getApplicablePaymentStages(order);
      return stages.length > 0 && stages.every((stage) => hasFilledString(stage[key]));
    }
    return hasFilledString(order[key]);
  });
}

function getMilestoneProgress(file: Partial<FileRecord>, milestone: string) {
  const key = getProgressFieldKey(milestone);
  if (!key) return undefined;
  const orders = isPaymentFieldKey(key)
    ? getPaymentProgressOrders(file, key)
    : fileSupplyOrders(file)
        .filter((order) => hasFilledString(order.soDate))
        .map((order) => ({ value: order[key] }));
  if (orders.length <= 1) return undefined;
  return {
    completed: orders.filter((order) => hasFilledString(order.value)).length,
    total: orders.length,
  };
}

function getPaymentProgressOrders(
  file: Partial<FileRecord>,
  key: "billPreparationDate" | "billSentForPaymentDate" | "paymentDate",
) {
  return (file.supplyOrders ?? [])
    .filter((order) => hasFilledString(order.soDate))
    .flatMap((order) => {
      if (isYes(order.stageDelivery) && isYes(order.stagePayment)) {
        return getApplicablePaymentStages(order).map((stage) => ({ value: stage[key] }));
      }
      return [{ value: order[key] }];
    });
}

function getApplicablePaymentStages(order: SupplyOrderDetail) {
  return (order.stageDeliveries ?? []).filter(isStagePaymentApplicable);
}

function isStagePaymentApplicable(stage: StageDeliveryDetail) {
  const effectiveDpDate = getLaterDate(stage.dpDate, stage.revisedDp);
  const dueDate = getNextLocalDate(effectiveDpDate);
  return hasFilledString(dueDate) && dueDate! <= formatLocalDate(new Date());
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  if (!hasFilledString(first)) return hasFilledString(second) ? second : undefined;
  if (!hasFilledString(second)) return first;
  return second! > first! ? second : first;
}

function getNextLocalDate(date: string | undefined) {
  if (!hasFilledString(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  parsed.setDate(parsed.getDate() + 1);
  return formatLocalDate(parsed);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getProgressFieldKey(milestone: string) {
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "delivery") return "materialReceiptDate";
  if (normalized === "irpreparation") return "irPreparationDate";
  if (normalized === "irreceipt") return "irReceiptDate";
  if (normalized === "billpreparation") return "billPreparationDate";
  if (normalized === "billsentforpayment") return "billSentForPaymentDate";
  if (normalized === "payment") return "paymentDate";
  return undefined;
}

function isPaymentFieldKey(
  key: string,
): key is "billPreparationDate" | "billSentForPaymentDate" | "paymentDate" {
  return key === "billPreparationDate" || key === "billSentForPaymentDate" || key === "paymentDate";
}

function normalizeMilestoneName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isDeliveryInspectionApplicable(file: Partial<FileRecord>) {
  const fileType = file.fileType?.trim().toLowerCase();
  return !["amc", "mpc", "cars", "o&m"].includes(fileType ?? "");
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}
