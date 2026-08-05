import type { Division, FileRecord, SupplyOrderDetail } from "@/lib/files-store";
import {
  advancePaymentEntries as normalizedAdvancePaymentEntries,
  countExpectedSupplyOrderRows,
  effectivePaymentEntries as normalizedPaymentEntries,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getAdvancePaymentCapital,
  getAdvancePaymentRevenue,
  getActualPaymentCapital,
  getActualPaymentRevenue,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "@/lib/effective-deliveries";
import { formatThousandsAndLakhs, getInrAmount } from "@/lib/money";

export type MmgSummaryFieldConfig = {
  key: string;
  label: string;
  enabled: boolean;
};

export type MmgSummaryFieldOption = {
  key: string;
  label: string;
  group: string;
};

export type MmgSummaryRow = {
  key: string;
  label: string;
  value: string;
};

const defaultModeKeys = new Set(["OBM", "PBM", "LPC", "SBM", "LBM"]);
const customModePrefix = "mode:";
const firmTypePrefix = "firmType:";

export const mmgSummaryFieldOptions: MmgSummaryFieldOption[] = [
  { key: "allocatedCapital", label: "Allocated Capital (Lakhs)", group: "Finance" },
  { key: "allocatedRevenue", label: "Allocated Revenue (Lakhs)", group: "Finance" },
  { key: "intendedCapital", label: "Intended Capital (Lakhs / %)", group: "Finance" },
  { key: "intendedRevenue", label: "Intended Revenue (Lakhs / %)", group: "Finance" },
  { key: "bookedCapital", label: "Booked Capital (Lakhs / %)", group: "Finance" },
  { key: "bookedRevenue", label: "Booked Revenue (Lakhs / %)", group: "Finance" },
  { key: "committedCapital", label: "Committed Capital (Lakhs / %)", group: "Finance" },
  { key: "committedRevenue", label: "Committed Revenue (Lakhs / %)", group: "Finance" },
  { key: "totalDemands", label: "Total No. of demands", group: "Demand summary" },
  { key: "nonTcecDemands", label: "Non-TCEC demands", group: "Demand summary" },
  { key: "tcecDemands", label: "TCEC demands", group: "Demand summary" },
  { key: "obm", label: "OBM", group: "Modes" },
  { key: "pbm", label: "PBM", group: "Modes" },
  { key: "lpc", label: "LPC", group: "Modes" },
  { key: "sbm", label: "SBM", group: "Modes" },
  { key: "lbm", label: "LBM", group: "Modes" },
  { key: "goodsServices", label: "Goods & Services", group: "File Type" },
  { key: "amc", label: "AMC", group: "File Type" },
  { key: "mpc", label: "MPC", group: "File Type" },
  { key: "cars", label: "CARS", group: "File Type" },
  { key: "om", label: "O&M", group: "File Type" },
  { key: "scrutinyCompleted", label: "Scrutiny completed", group: "Scrutiny and vetting" },
  {
    key: "filesWithUsersAfterScrutiny",
    label: "Files with users after scrutiny",
    group: "Scrutiny and vetting",
  },
  { key: "scrutinyToBeDone", label: "Scrutiny to be done", group: "Scrutiny and vetting" },
  { key: "tcecCompleted", label: "TCEC completed", group: "Scrutiny and vetting" },
  {
    key: "tcecFilesWithUserAfterScrutiny",
    label: "TCEC files with user after scrutiny",
    group: "Scrutiny and vetting",
  },
  {
    key: "tcecFilesWithMmgForMeeting",
    label: "TCEC files with MMG for conducting meeting",
    group: "Scrutiny and vetting",
  },
  { key: "highValueDemands", label: "High value demands (>3Cr)", group: "Scrutiny and vetting" },
  {
    key: "highValueReviewCompleted",
    label: "High value review completed",
    group: "Scrutiny and vetting",
  },
  { key: "adVettingDemands", label: "AD vetting demands", group: "Scrutiny and vetting" },
  { key: "adVettingCompleted", label: "AD vetting completed", group: "Scrutiny and vetting" },
  { key: "adVettingRemaining", label: "AD vetting remaining", group: "Scrutiny and vetting" },
  { key: "rqaDemands", label: "R&QA demands", group: "Scrutiny and vetting" },
  { key: "rqaVettingDone", label: "R&QA vetting done", group: "Scrutiny and vetting" },
  { key: "rqaVettingRemaining", label: "R&QA vetting remaining", group: "Scrutiny and vetting" },
  { key: "controllingDone", label: "Controlling done", group: "Approvals" },
  { key: "controllingRemaining", label: "Controlling remaining", group: "Approvals" },
  { key: "filesWithIfa", label: "Files with IFA", group: "Approvals" },
  { key: "ifaApprovalDone", label: "IFA approval done", group: "Approvals" },
  { key: "cfaApprovalDone", label: "CFA approval done", group: "Approvals" },
  { key: "cfaApprovalRemaining", label: "CFA approval remaining", group: "Approvals" },
  { key: "liveBids", label: "Live bids", group: "Bidding and S.O." },
  { key: "bidsToBeOpened", label: "Bids to be opened", group: "Bidding and S.O." },
  { key: "bidsOverdueToOpen", label: "Bids overdue to open", group: "Bidding and S.O." },
  {
    key: "postTcecEvaluationInProgress",
    label: "Post TCEC evaluation in progress",
    group: "Bidding and S.O.",
  },
  { key: "postTcecCompleted", label: "Post TCEC completed", group: "Bidding and S.O." },
  { key: "cncDue", label: "CNC due", group: "Bidding and S.O." },
  { key: "cncCompleted", label: "CNC completed", group: "Bidding and S.O." },
  {
    key: "financialSanctionCompleted",
    label: "Financial Sanction completed",
    group: "Bidding and S.O.",
  },
  {
    key: "financialSanctionPending",
    label: "Financial Sanction pending",
    group: "Bidding and S.O.",
  },
  { key: "soTotal", label: "S.O. total", group: "Bidding and S.O." },
  { key: "soPlaced", label: "S.O. placed", group: "Bidding and S.O." },
  { key: "soPending", label: "S.O. pending", group: "Bidding and S.O." },
  { key: "soLive", label: "S.O. live", group: "Bidding and S.O." },
  { key: "deliveriesDueThisMonth", label: "No. of deliveries due this month", group: "Delivery" },
  {
    key: "deliveriesCompletedThisMonth",
    label: "No. of deliveries completed this month",
    group: "Delivery",
  },
  { key: "deliveryCompleted", label: "Delivery completed", group: "Delivery" },
  { key: "deliveryPending", label: "Delivery pending", group: "Delivery" },
  { key: "deliveryOverdue", label: "Delivery overdue", group: "Delivery" },
  { key: "deliveryPeriodValid", label: "Delivery Period valid", group: "Delivery" },
  { key: "deliveryPeriodExpired", label: "Delivery Period expired", group: "Delivery" },
  { key: "deliveryPeriodExtended", label: "Delivery Period extended", group: "Delivery" },
  { key: "irPreparationPending", label: "IR Preparation pending", group: "Delivery" },
  { key: "irReceiptPending", label: "IR Receipt pending", group: "Delivery" },
  { key: "irCompleted", label: "IR completed", group: "Delivery" },
  { key: "totalIrSentToUser", label: "Total IR sent to user", group: "Delivery" },
  { key: "totalIrReceived", label: "Total IR received", group: "Delivery" },
  { key: "billPreparationPending", label: "Bill preparation pending", group: "Payment" },
  { key: "billPreparationCompleted", label: "Bill preparation completed", group: "Payment" },
  { key: "billSentForPaymentPending", label: "Bill sent for payment pending", group: "Payment" },
  {
    key: "billSentForPaymentCompleted",
    label: "Bill sent for payment completed",
    group: "Payment",
  },
  { key: "paymentPending", label: "Payment pending", group: "Payment" },
  { key: "paymentCompleted", label: "Payment completed", group: "Payment" },
  { key: "totalPaymentDueThisMonth", label: "Total payment due this month", group: "Payment" },
  {
    key: "billsSentForCurrentMonthDeliveries",
    label: "Bills sent for current month deliveries",
    group: "Payment",
  },
  {
    key: "paymentDueFromPreviousMonths",
    label: "Payment due from previous months",
    group: "Payment",
  },
  {
    key: "billsSentForPreviousMonthsDeliveries",
    label: "Bills sent for previous months deliveries",
    group: "Payment",
  },
  { key: "totalBillsSentThisMonth", label: "Total bills sent this month", group: "Payment" },
  { key: "totalPaymentsMadeThisYear", label: "Total payments made (Lakhs)", group: "Payment" },
  { key: "actualPaymentCapital", label: "Actual payment Capital (Lakhs)", group: "Payment" },
  { key: "actualPaymentRevenue", label: "Actual payment Revenue (Lakhs)", group: "Payment" },
  { key: "advancePaymentCount", label: "Advance payment count", group: "Payment" },
  { key: "advancePaid", label: "Advance paid", group: "Payment" },
  { key: "advancePending", label: "Advance pending", group: "Payment" },
  { key: "advancePaymentCapital", label: "Advance payment Capital (Lakhs)", group: "Payment" },
  { key: "advancePaymentRevenue", label: "Advance payment Revenue (Lakhs)", group: "Payment" },
  {
    key: "totalExpectedPaymentRemainingThisYear",
    label: "Total expected payment remaining (Lakhs)",
    group: "Payment",
  },
  { key: "liveFilesThisYear", label: "Number of live files", group: "Files" },
  { key: "closedFilesThisYear", label: "Number of closed files", group: "Files" },
  {
    key: "liveFilesPreviousYears",
    label: "Number of live files in filter",
    group: "Files",
  },
  { key: "cancelledDemands", label: "Cancelled demands", group: "Additional" },
  { key: "soCancelled", label: "S.O. cancelled", group: "Additional" },
  { key: "deliveriesOverdue", label: "Deliveries overdue", group: "Additional" },
  { key: "paymentsOverdue", label: "Payments overdue", group: "Additional" },
  { key: "psbPending", label: "PSB pending", group: "Security/Warranty BG" },
  { key: "psbReceived", label: "PSB received", group: "Security/Warranty BG" },
  { key: "psbExpired", label: "PSB expired", group: "Security/Warranty BG" },
  { key: "psbToBeReturned", label: "PSB to be returned", group: "Security/Warranty BG" },
  { key: "psbReturned", label: "PSB returned", group: "Security/Warranty BG" },
  { key: "pwbPending", label: "PWB pending", group: "Security/Warranty BG" },
  { key: "pwbReceived", label: "PWB received", group: "Security/Warranty BG" },
  { key: "pwbExpired", label: "PWB expired", group: "Security/Warranty BG" },
  { key: "pwbToBeReturned", label: "PWB to be returned", group: "Security/Warranty BG" },
  { key: "pwbReturned", label: "PWB returned", group: "Security/Warranty BG" },
  { key: "psbPwbPending", label: "PSB+PWB pending", group: "Security/Warranty BG" },
  { key: "psbPwbReceived", label: "PSB+PWB received", group: "Security/Warranty BG" },
  { key: "psbPwbExpired", label: "PSB+PWB expired", group: "Security/Warranty BG" },
  { key: "psbPwbToBeReturned", label: "PSB+PWB to be returned", group: "Security/Warranty BG" },
  { key: "psbPwbReturned", label: "PSB+PWB returned", group: "Security/Warranty BG" },
  { key: "multipleSupplyOrders", label: "Multiple S.O.", group: "Additional" },
  { key: "ld", label: "LD", group: "Additional" },
  { key: "dpExtension", label: "D.P. extension", group: "Additional" },
  { key: "dpExtensionCount", label: "Extension count", group: "Additional" },
  { key: "revisedDp", label: "Revised D.P.", group: "Additional" },
  {
    key: "totalSoValuePlacedThisFy",
    label: "Total S.O. value placed (Lakhs)",
    group: "Additional",
  },
  { key: "totalUnpaidSoValue", label: "Total unpaid S.O. value (Lakhs)", group: "Additional" },
  {
    key: "filesClosedPercentage",
    label: "Files closed percentage of total demands",
    group: "Additional",
  },
];

export function getMmgSummaryFieldOptions(
  modes?: string[],
  firmTypes?: string[],
  config?: MmgSummaryFieldConfig[],
): MmgSummaryFieldOption[] {
  const optionByKey = new Map(mmgSummaryFieldOptions.map((option) => [option.key, option]));
  const customModeOptions = [...(modes ?? []), ...getCustomModeNamesFromConfig(config)]
    .map(normalizeModeName)
    .filter((mode) => mode && !defaultModeKeys.has(mode))
    .map((mode) => ({
      key: getCustomModeKey(mode),
      label: mode,
      group: "Modes",
    }));

  customModeOptions.forEach((option) => {
    if (!optionByKey.has(option.key)) optionByKey.set(option.key, option);
  });
  const firmTypeOptions = [...(firmTypes ?? []), ...getFirmTypeNamesFromConfig(config)]
    .map(normalizeConfigName)
    .filter(Boolean)
    .map((firmType) => ({
      key: getFirmTypeKey(firmType),
      label: firmType,
      group: "Firm Type",
    }));

  firmTypeOptions.forEach((option) => {
    if (!optionByKey.has(option.key)) optionByKey.set(option.key, option);
  });

  return Array.from(optionByKey.values());
}

export function getDefaultMmgSummaryFields(modes?: string[], firmTypes?: string[]) {
  return getMmgSummaryFieldOptions(modes, firmTypes).map((option) => ({
    key: option.key,
    label: option.label,
    enabled: true,
  }));
}

export function normalizeMmgSummaryFields(
  value: unknown,
  modes?: string[],
  firmTypes?: string[],
): MmgSummaryFieldConfig[] {
  if (!Array.isArray(value) || value.length === 0)
    return getDefaultMmgSummaryFields(modes, firmTypes);
  const byKey = new Map<string, MmgSummaryFieldConfig>();
  const options = getMmgSummaryFieldOptions(
    modes,
    firmTypes,
    value.filter(
      (item): item is MmgSummaryFieldConfig =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)) &&
        typeof (item as Record<string, unknown>).key === "string",
    ),
  );
  const optionByKey = new Map(options.map((option) => [option.key, option]));
  value.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.key !== "string" || !optionByKey.has(candidate.key)) return;
    const option = optionByKey.get(candidate.key);
    byKey.set(candidate.key, {
      key: candidate.key,
      label: option?.label ?? candidate.key,
      enabled: candidate.enabled !== false,
    });
  });
  return options.map(
    (option) =>
      byKey.get(option.key) ?? {
        key: option.key,
        label: option.label,
        enabled: true,
      },
  );
}

export function buildMmgSummaryRows({
  files,
  divisions,
  previousYearFiles,
  config,
  financialYear,
  modes,
  firmTypes,
}: {
  files: FileRecord[];
  divisions: Division[];
  previousYearFiles?: FileRecord[];
  config: MmgSummaryFieldConfig[];
  financialYear: string;
  modes?: string[];
  firmTypes?: string[];
}): MmgSummaryRow[] {
  const values = getMmgSummaryValues(files, divisions, previousYearFiles ?? [], financialYear);
  return normalizeMmgSummaryFields(config, modes, firmTypes)
    .filter((field) => field.enabled)
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: values[field.key] ?? "0",
    }));
}

function getCustomModeNamesFromConfig(config: MmgSummaryFieldConfig[] | undefined) {
  return (config ?? [])
    .map((field) => (field.key.startsWith(customModePrefix) ? decodeCustomModeKey(field.key) : ""))
    .filter(Boolean);
}

function getFirmTypeNamesFromConfig(config: MmgSummaryFieldConfig[] | undefined) {
  return (config ?? [])
    .map((field) => (field.key.startsWith(firmTypePrefix) ? decodeFirmTypeKey(field.key) : ""))
    .filter(Boolean);
}

function getCustomModeKey(mode: string) {
  return `${customModePrefix}${encodeURIComponent(normalizeModeName(mode))}`;
}

function decodeCustomModeKey(key: string) {
  try {
    return normalizeModeName(decodeURIComponent(key.slice(customModePrefix.length)));
  } catch {
    return normalizeModeName(key.slice(customModePrefix.length));
  }
}

function normalizeModeName(mode: string | undefined) {
  return mode?.trim().toUpperCase() ?? "";
}

function getFirmTypeKey(firmType: string) {
  return `${firmTypePrefix}${encodeURIComponent(normalizeFirmTypeKey(firmType))}`;
}

function decodeFirmTypeKey(key: string) {
  try {
    return normalizeConfigName(decodeURIComponent(key.slice(firmTypePrefix.length)));
  } catch {
    return normalizeConfigName(key.slice(firmTypePrefix.length));
  }
}

function normalizeConfigName(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeFirmTypeKey(value: string | undefined) {
  return normalizeConfigName(value).toLowerCase();
}

function getMmgSummaryValues(
  files: FileRecord[],
  divisions: Division[],
  _previousYearFiles: FileRecord[],
  financialYear: string,
) {
  void _previousYearFiles;
  void financialYear;
  const allocatedCapital = divisions.reduce(
    (sum, division) => sum + (parseAmount(division.allocatedCapital) ?? 0),
    0,
  );
  const allocatedRevenue = divisions.reduce(
    (sum, division) => sum + (parseAmount(division.allocatedRevenue) ?? 0),
    0,
  );
  const nonCancelledFiles = files.filter((file) => !isCancelledDemand(file));
  const currentMonthKey = getCurrentMonthKey();
  const intendedCapital = sumFiles(nonCancelledFiles, (file) =>
    hasFilledString(file.imms) ? 0 : getFileAmount(file, "capital"),
  );
  const intendedRevenue = sumFiles(nonCancelledFiles, (file) =>
    hasFilledString(file.imms) ? 0 : getFileAmount(file, "revenue"),
  );
  const bookedCapital = sumFiles(nonCancelledFiles, (file) =>
    hasAnyActiveRawOrderAmount(file, "capital") ? 0 : getFileAmount(file, "capital"),
  );
  const bookedRevenue = sumFiles(nonCancelledFiles, (file) =>
    hasAnyActiveRawOrderAmount(file, "revenue") ? 0 : getFileAmount(file, "revenue"),
  );
  const orders = effectiveOrderEntries(files);
  const rawOrders = rawOrderEntries(files);
  const rawActiveOrders = rawOrders.filter(({ file, order }) => !isCancelledOrder(file, order));
  const committedCapital = rawActiveOrders.reduce(
    (sum, { file, order }) => sum + getOrderAmount(file, order, "capital"),
    0,
  );
  const committedRevenue = rawActiveOrders.reduce(
    (sum, { file, order }) => sum + getOrderAmount(file, order, "revenue"),
    0,
  );
  const paymentOrders = normalizedPaymentEntries(files).filter(
    ({ order }) => order.stageDeliveryLabel !== "Advance Payment",
  );
  const actualPaymentEntries = paymentOrders.filter(
    ({ file, order }) => !isCancelledOrder(file, order) && hasFilledString(order.paymentDate),
  );
  const advancePaymentEntries = normalizedAdvancePaymentEntries(files).filter(
    ({ file, order }) => !isCancelledOrder(file, order),
  );
  const liveFiles = files.filter((file) => !isCancelledDemand(file) && !isFileClosed(file));
  const closedFiles = nonCancelledFiles.filter(isFileClosed);

  const values: Record<string, string> = {
    allocatedCapital: formatMoney(allocatedCapital),
    allocatedRevenue: formatMoney(allocatedRevenue),
    intendedCapital: formatValuePercent(intendedCapital, allocatedCapital),
    intendedRevenue: formatValuePercent(intendedRevenue, allocatedRevenue),
    bookedCapital: formatValuePercent(bookedCapital, allocatedCapital),
    bookedRevenue: formatValuePercent(bookedRevenue, allocatedRevenue),
    committedCapital: formatValuePercent(committedCapital, allocatedCapital),
    committedRevenue: formatValuePercent(committedRevenue, allocatedRevenue),
    totalDemands: formatCount(nonCancelledFiles.length),
    nonTcecDemands: formatCount(nonCancelledFiles.filter((file) => isNo(file.tcec)).length),
    tcecDemands: formatCount(nonCancelledFiles.filter((file) => isYes(file.tcec)).length),
    obm: countMode(nonCancelledFiles, "OBM"),
    pbm: countMode(nonCancelledFiles, "PBM"),
    lpc: countMode(nonCancelledFiles, "LPC"),
    sbm: countMode(nonCancelledFiles, "SBM"),
    lbm: countMode(nonCancelledFiles, "LBM"),
    goodsServices: countGoodsServicesFileType(nonCancelledFiles),
    amc: countFileType(nonCancelledFiles, "amc"),
    mpc: countFileType(nonCancelledFiles, "mpc"),
    cars: countFileType(nonCancelledFiles, "cars"),
    om: countFileType(nonCancelledFiles, "o&m"),
    scrutinyCompleted: countFiles(nonCancelledFiles, (file) =>
      hasFilledString(file.scrutinyCompletionDate),
    ),
    filesWithUsersAfterScrutiny: countFiles(
      nonCancelledFiles,
      (file) => !hasFilledString(file.scrutinyCompletionDate),
    ),
    scrutinyToBeDone: countFiles(nonCancelledFiles, (file) => !hasFilledString(file.scrutinyDate)),
    tcecCompleted: countFiles(
      nonCancelledFiles,
      (file) => isYes(file.tcec) && hasFilledString(file.preTcecMinutesDate),
    ),
    tcecFilesWithUserAfterScrutiny: countFiles(
      nonCancelledFiles,
      (file) =>
        isYes(file.tcec) &&
        hasFilledString(file.scrutinyCompletionDate) &&
        !hasFilledString(file.preTcecDate),
    ),
    tcecFilesWithMmgForMeeting: countFiles(
      nonCancelledFiles,
      (file) =>
        isYes(file.tcec) &&
        hasFilledString(file.preTcecDate) &&
        !hasFilledString(file.preTcecMinutesDate),
    ),
    highValueDemands: countFiles(nonCancelledFiles, (file) => isYes(file.highValue)),
    highValueReviewCompleted: countFiles(nonCancelledFiles, (file) =>
      hasFilledString(file.highValueMinutesDate),
    ),
    adVettingDemands: countFiles(nonCancelledFiles, (file) => isYes(file.ad)),
    adVettingCompleted: countFiles(nonCancelledFiles, (file) =>
      hasFilledString(file.adVettingDate),
    ),
    adVettingRemaining: countFiles(
      nonCancelledFiles,
      (file) => isYes(file.ad) && !hasFilledString(file.adVettingDate),
    ),
    rqaDemands: countFiles(nonCancelledFiles, (file) => isYes(file.rqa)),
    rqaVettingDone: countFiles(nonCancelledFiles, (file) => hasFilledString(file.rqaApprovalDate)),
    rqaVettingRemaining: countFiles(
      nonCancelledFiles,
      (file) => isYes(file.rqa) && !hasFilledString(file.rqaApprovalDate),
    ),
    controllingDone: countFiles(
      nonCancelledFiles,
      (file) => hasFilledString(file.imms) || hasFilledString(file.immsDate),
    ),
    controllingRemaining: countFiles(
      nonCancelledFiles,
      (file) => !hasFilledString(file.imms) && !hasFilledString(file.immsDate),
    ),
    filesWithIfa: countFiles(
      nonCancelledFiles,
      (file) => hasFilledString(file.ifaSentDate) && !hasFilledString(file.ifaFinalDate),
    ),
    ifaApprovalDone: countFiles(nonCancelledFiles, (file) => hasFilledString(file.ifaFinalDate)),
    cfaApprovalDone: countFiles(nonCancelledFiles, (file) => hasFilledString(file.cfaDate)),
    cfaApprovalRemaining: countFiles(nonCancelledFiles, (file) => !hasFilledString(file.cfaDate)),
    liveBids: countFiles(nonCancelledFiles, (file) => isYes(file.tenderLive)),
    bidsToBeOpened: countFiles(nonCancelledFiles, isBidToBeOpened),
    bidsOverdueToOpen: countFiles(nonCancelledFiles, isBidOverdueToOpen),
    postTcecEvaluationInProgress: countFiles(
      nonCancelledFiles,
      (file) =>
        isYes(file.tcec) &&
        hasFilledString(file.postTcecDate) &&
        !hasFilledString(file.postTcecMinutesDate),
    ),
    postTcecCompleted: countFiles(nonCancelledFiles, (file) =>
      hasFilledString(file.postTcecMinutesDate),
    ),
    cncDue: countFiles(
      nonCancelledFiles,
      (file) =>
        isYes(file.tcec) &&
        !hasFilledString(file.cncDate) &&
        !hasFilledString(file.cncApprovalDate),
    ),
    cncCompleted: countFiles(nonCancelledFiles, (file) => hasFilledString(file.cncApprovalDate)),
    financialSanctionCompleted: formatCount(
      rawActiveOrders.filter(({ order }) => isFinancialSanctionCompleted(order)).length,
    ),
    financialSanctionPending: formatCount(
      rawActiveOrders.filter(
        ({ order }) =>
          normalizeMilestoneName(order.currentMilestone) === "financialsanction" &&
          !isFinancialSanctionCompleted(order),
      ).length,
    ),
    soTotal: formatCount(
      rawActiveOrders.filter(({ file, order }) => isSupplyOrderTabComplete(file, order)).length,
    ),
    soPlaced: formatCount(
      rawActiveOrders.filter(({ file, order }) => isSupplyOrderTabComplete(file, order)).length,
    ),
    soPending: formatCount(
      expectedOrderEntries(nonCancelledFiles).filter(({ file, order }) =>
        isSupplyOrderPendingOrder(file, order),
      ).length,
    ),
    soLive: formatCount(
      rawActiveOrders.filter(
        ({ file, order }) =>
          isSupplyOrderTabComplete(file, order) && !hasFilledString(order.paymentDate),
      ).length,
    ),
    deliveriesDueThisMonth: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          monthMatches(getDeliveryPeriodDate(order), currentMonthKey) &&
          !hasFilledString(order.materialReceiptDate),
      ).length,
    ),
    deliveriesCompletedThisMonth: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          monthMatches(order.materialReceiptDate, currentMonthKey),
      ).length,
    ),
    deliveryCompleted: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          hasFilledString(order.materialReceiptDate),
      ).length,
    ),
    deliveryPending: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          hasSupplyOrderDate(order) &&
          !hasFilledString(order.materialReceiptDate) &&
          hasFilledString(getDeliveryPeriodDate(order)),
      ).length,
    ),
    deliveryOverdue: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          hasSupplyOrderDate(order) &&
          !hasFilledString(order.materialReceiptDate) &&
          hasFilledString(getDeliveryPeriodDate(order)) &&
          isBeforeToday(getDeliveryPeriodDate(order)),
      ).length,
    ),
    deliveryPeriodValid: formatCount(
      orders.filter(({ file, order }) => isValidDeliveryPeriodEntry(file, order)).length,
    ),
    deliveryPeriodExpired: formatCount(
      orders.filter(({ file, order }) => isExpiredDeliveryPeriodEntry(file, order)).length,
    ),
    deliveryPeriodExtended: formatCount(
      orders.filter(({ file, order }) => isExtendedDeliveryPeriodEntry(file, order)).length,
    ),
    irPreparationPending: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          isYes(file.ir) &&
          hasSupplyOrderDate(order) &&
          hasFilledString(order.materialReceiptDate) &&
          !hasFilledString(order.irPreparationDate),
      ).length,
    ),
    irReceiptPending: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          isYes(file.ir) &&
          hasFilledString(order.irPreparationDate) &&
          !hasFilledString(order.irReceiptDate),
      ).length,
    ),
    irCompleted: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          isYes(file.ir) &&
          hasFilledString(order.irReceiptDate),
      ).length,
    ),
    totalIrSentToUser: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          hasFilledString(order.irPreparationDate),
      ).length,
    ),
    totalIrReceived: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          hasFilledString(order.irReceiptDate),
      ).length,
    ),
    billPreparationPending: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          hasFilledString(order.irReceiptDate || order.materialReceiptDate) &&
          !hasFilledString(order.billPreparationDate),
      ).length,
    ),
    billPreparationCompleted: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) && hasFilledString(order.billPreparationDate),
      ).length,
    ),
    billSentForPaymentPending: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          hasFilledString(order.billPreparationDate) &&
          !hasFilledString(order.billSentForPaymentDate),
      ).length,
    ),
    billSentForPaymentCompleted: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) && hasFilledString(order.billSentForPaymentDate),
      ).length,
    ),
    paymentPending: formatCount(
      paymentOrders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          hasPaymentWorkflowStarted(file, order) &&
          !hasFilledString(order.paymentDate),
      ).length,
    ),
    paymentCompleted: formatCount(
      paymentOrders.filter(
        ({ file, order }) => !isCancelledOrder(file, order) && hasFilledString(order.paymentDate),
      ).length,
    ),
    totalPaymentDueThisMonth: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthMatches(order.materialReceiptDate, currentMonthKey) &&
          !hasFilledString(order.paymentDate),
      ).length,
    ),
    billsSentForCurrentMonthDeliveries: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthMatches(order.materialReceiptDate, currentMonthKey) &&
          hasFilledString(order.billSentForPaymentDate),
      ).length,
    ),
    paymentDueFromPreviousMonths: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthBefore(order.materialReceiptDate, currentMonthKey) &&
          !hasFilledString(order.paymentDate),
      ).length,
    ),
    billsSentForPreviousMonthsDeliveries: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthBefore(order.materialReceiptDate, currentMonthKey) &&
          monthMatches(order.billSentForPaymentDate, currentMonthKey),
      ).length,
    ),
    totalBillsSentThisMonth: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthMatches(order.billSentForPaymentDate, currentMonthKey),
      ).length,
    ),
    totalPaymentsMadeThisYear: formatMoney(
      actualPaymentEntries.reduce(
        (sum, { file, order }) => sum + getActualPaymentTotal(file, order),
        0,
      ),
    ),
    actualPaymentCapital: formatMoney(
      actualPaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentCapital(order), file) ?? 0),
        0,
      ),
    ),
    actualPaymentRevenue: formatMoney(
      actualPaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentRevenue(order), file) ?? 0),
        0,
      ),
    ),
    advancePaymentCount: formatCount(advancePaymentEntries.length),
    advancePaid: formatCount(
      advancePaymentEntries.filter(({ order }) => isAdvancePaymentPaid(order)).length,
    ),
    advancePending: formatCount(
      advancePaymentEntries.filter(({ order }) => isAdvancePaymentPending(order)).length,
    ),
    advancePaymentCapital: formatMoney(
      advancePaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0),
        0,
      ),
    ),
    advancePaymentRevenue: formatMoney(
      advancePaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0),
        0,
      ),
    ),
    totalExpectedPaymentRemainingThisYear: formatMoney(
      sumOrders(files, ({ file, order }) =>
        !isCancelledOrder(file, order) &&
        !hasFilledString(order.materialReceiptDate) &&
        !hasFilledString(order.paymentDate)
          ? getOrderTotal(file, order)
          : 0,
      ),
    ),
    liveFilesThisYear: formatCount(liveFiles.length),
    closedFilesThisYear: formatCount(closedFiles.length),
    liveFilesPreviousYears: formatCount(liveFiles.length),
    cancelledDemands: countFiles(files, isDemandCancelled),
    soCancelled: formatCount(countCancelledSupplyOrders(files)),
    deliveriesOverdue: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          isDeliveryInspectionApplicable(file) &&
          Boolean(getDeliveryPeriodDate(order)) &&
          isBeforeToday(getDeliveryPeriodDate(order)) &&
          !hasFilledString(order.materialReceiptDate),
      ).length,
    ),
    paymentsOverdue: formatCount(
      orders.filter(
        ({ file, order }) =>
          !isCancelledOrder(file, order) &&
          monthBefore(order.materialReceiptDate, currentMonthKey) &&
          !hasFilledString(order.paymentDate),
      ).length,
    ),
    psbPending: formatCount(countBgPendingOrders(nonCancelledFiles, "psb")),
    psbReceived: formatCount(countBgReceivedOrders(nonCancelledFiles, "psb")),
    psbExpired: formatCount(countBgExpiredOrders(nonCancelledFiles, "psb")),
    psbToBeReturned: formatCount(countBgToBeReturnedOrders(nonCancelledFiles, "psb")),
    psbReturned: formatCount(countBgReturnedOrders(nonCancelledFiles, "psb")),
    pwbPending: formatCount(countBgPendingOrders(nonCancelledFiles, "pwb")),
    pwbReceived: formatCount(countBgReceivedOrders(nonCancelledFiles, "pwb")),
    pwbExpired: formatCount(countBgExpiredOrders(nonCancelledFiles, "pwb")),
    pwbToBeReturned: formatCount(countBgToBeReturnedOrders(nonCancelledFiles, "pwb")),
    pwbReturned: formatCount(countBgReturnedOrders(nonCancelledFiles, "pwb")),
    psbPwbPending: formatCount(countBgPendingOrders(nonCancelledFiles, "psbpwb")),
    psbPwbReceived: formatCount(countBgReceivedOrders(nonCancelledFiles, "psbpwb")),
    psbPwbExpired: formatCount(countBgExpiredOrders(nonCancelledFiles, "psbpwb")),
    psbPwbToBeReturned: formatCount(countBgToBeReturnedOrders(nonCancelledFiles, "psbpwb")),
    psbPwbReturned: formatCount(countBgReturnedOrders(nonCancelledFiles, "psbpwb")),
    multipleSupplyOrders: formatCount(
      nonCancelledFiles.filter((file) => countExpectedSupplyOrderRows(file) > 1).length,
    ),
    ld: formatCount(rawActiveOrders.filter(({ order }) => isYes(order.ld)).length),
    dpExtension: formatCount(
      rawActiveOrders.filter(({ order }) => isYes(order.dpExtension)).length,
    ),
    dpExtensionCount: formatCount(
      rawActiveOrders.reduce(
        (sum, { order }) => sum + (parseAmount(order.dpExtensionCount) ?? 0),
        0,
      ),
    ),
    revisedDp: formatCount(
      rawActiveOrders.filter(({ order }) => hasFilledString(order.revisedDp)).length,
    ),
    totalSoValuePlacedThisFy: formatMoney(
      rawActiveOrders.reduce(
        (sum, { file, order }) => sum + (hasSupplyOrderDate(order) ? getOrderTotal(file, order) : 0),
        0,
      ),
    ),
    totalUnpaidSoValue: formatMoney(
      sumOrders(files, ({ file, order }) =>
        !isCancelledOrder(file, order) && !hasFilledString(order.paymentDate)
          ? getOrderTotal(file, order)
          : 0,
      ),
    ),
    filesClosedPercentage: `${getPercent(closedFiles.length, nonCancelledFiles.length)}%`,
  };
  nonCancelledFiles.forEach((file) => {
    const mode = normalizeModeName(file.mode);
    if (!mode || defaultModeKeys.has(mode)) return;
    values[getCustomModeKey(mode)] = countMode(nonCancelledFiles, mode);
  });
  getFirmTypesInFiles(nonCancelledFiles).forEach((firmType) => {
    values[getFirmTypeKey(firmType)] = countFiles(nonCancelledFiles, (file) =>
      rawSupplyOrders(file).some(
        (order) =>
          !isCancelledOrder(file, order) &&
          normalizeFirmTypeKey(getFirmTypeName(order)) === normalizeFirmTypeKey(firmType),
      ),
    );
  });
  return values;
}

function countMode(files: FileRecord[], mode: string) {
  return formatCount(files.filter((file) => file.mode?.trim().toUpperCase() === mode).length);
}

function countFileType(files: FileRecord[], fileType: string) {
  return formatCount(
    files.filter((file) => file.fileType?.trim().toLowerCase() === fileType).length,
  );
}

function countGoodsServicesFileType(files: FileRecord[]) {
  const specialFileTypes = new Set(["amc", "mpc", "cars", "o&m"]);
  return formatCount(
    files.filter((file) => !specialFileTypes.has(file.fileType?.trim().toLowerCase() ?? "")).length,
  );
}

function getFirmTypesInFiles(files: FileRecord[]) {
  const firmTypes = new Set<string>();
  files.forEach((file) => {
    rawSupplyOrders(file).forEach((order) => {
      if (isCancelledOrder(file, order)) return;
      const firmType = getFirmTypeName(order);
      if (firmType) firmTypes.add(firmType);
    });
  });
  return Array.from(firmTypes.values());
}

function getFirmTypeName(order: SupplyOrderDetail) {
  return normalizeConfigName(order.firmTypeOther || order.firmType);
}

function countFiles(files: FileRecord[], predicate: (file: FileRecord) => boolean) {
  return formatCount(files.filter(predicate).length);
}

function countCancelledSupplyOrders(files: FileRecord[]) {
  return files.reduce((total, file) => {
    if (isDemandCancelled(file)) return total;
    const cancelledRows = rawSupplyOrders(file).filter((order) => isYes(order.soCancelled)).length;
    if (cancelledRows > 0) return total + cancelledRows;
    return total + (isYes(file.soCancelled) ? 1 : 0);
  }, 0);
}

function sumFiles(files: FileRecord[], getValue: (file: FileRecord) => number) {
  return files.reduce((sum, file) => sum + getValue(file), 0);
}

function sumOrders(
  files: FileRecord[],
  getValue: (entry: { file: FileRecord; order: SupplyOrderDetail }) => number,
) {
  return effectiveOrderEntries(files).reduce((sum, entry) => sum + getValue(entry), 0);
}

function effectiveOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => fileSupplyOrders(file).map((order) => ({ file, order })));
}

function rawOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => rawSupplyOrders(file).map((order) => ({ file, order })));
}

function expectedOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) =>
    normalizedExpectedSupplyOrders(file).map((order) => ({ file, order })),
  );
}

function fileSupplyOrders(file: FileRecord) {
  return normalizedFileSupplyOrders(file);
}

function rawSupplyOrders(file: FileRecord) {
  return normalizedRawSupplyOrders(file);
}

function getFileAmount(file: FileRecord, type: "capital" | "revenue") {
  return getInrAmount(type === "capital" ? file.valueCapital : file.valueRevenue, file) ?? 0;
}

function getOrderAmount(file: FileRecord, order: SupplyOrderDetail, type: "capital" | "revenue") {
  return getInrAmount(type === "capital" ? order.soValueCapital : order.soValueRevenue, file) ?? 0;
}

function getOrderTotal(file: FileRecord, order: SupplyOrderDetail) {
  return getOrderAmount(file, order, "capital") + getOrderAmount(file, order, "revenue");
}

function getActualPaymentTotal(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(getActualPaymentCapital(order), file) ?? 0) +
    (getInrAmount(getActualPaymentRevenue(order), file) ?? 0)
  );
}

function hasAnyActiveRawOrderAmount(file: FileRecord, type: "capital" | "revenue") {
  return rawSupplyOrders(file).some(
    (order) =>
      !isCancelledOrder(file, order) &&
      hasAmount(type === "capital" ? order.soValueCapital : order.soValueRevenue),
  );
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  const fileType = file.fileType?.trim().toLowerCase();
  return !["amc", "mpc", "cars", "o&m"].includes(fileType ?? "");
}

function isCancelledDemand(file: FileRecord) {
  if (isDemandCancelled(file)) return true;
  const supplyOrders = file.supplyOrders ?? [];
  if (supplyOrders.length === 0) return false;
  return supplyOrders.every((order) => isYes(order.soCancelled));
}

function isDemandCancelled(file: FileRecord) {
  return isYes(file.demandCancelled);
}

function isCancelledOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(order.soCancelled);
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) => normalizeMilestoneName(milestone) === "fileclosed",
    ),
  );
}

function isBidToBeOpened(file: FileRecord) {
  return (
    hasFilledString(file.bidOpeningDate) &&
    !isBeforeToday(file.bidOpeningDate) &&
    !isYes(file.bidOpened) &&
    !isYes(file.biddingStageOver)
  );
}

function isBidOverdueToOpen(file: FileRecord) {
  return (
    hasFilledString(file.bidOpeningDate) &&
    isBeforeToday(file.bidOpeningDate) &&
    !isYes(file.bidOpened) &&
    !isYes(file.biddingStageOver)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseDate(first);
  const secondTime = parseDate(second);
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function hasSupplyOrderValue(file: FileRecord, order: SupplyOrderDetail) {
  const capitalSelected = (getInrAmount(file.valueCapital, file) ?? 0) !== 0;
  const revenueSelected = (getInrAmount(file.valueRevenue, file) ?? 0) !== 0;
  if (capitalSelected) return hasFilledString(order.soValueCapital);
  if (revenueSelected) return hasFilledString(order.soValueRevenue);
  return hasFilledString(order.soValueCapital) || hasFilledString(order.soValueRevenue);
}

function isSupplyOrderTabComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!hasFilledString(order.soNo)) return false;
  if (!isNo(file.gem) && !hasFilledString(order.gemSoNo)) return false;
  if (!hasFilledString(order.soDate)) return false;
  if (!hasSupplyOrderValue(file, order)) return false;
  if (!hasFilledString(order.firm)) return false;
  if (!hasFilledString(order.firmType)) return false;
  if (
    (order.firmType ?? "").trim().toUpperCase() === "OTHER" &&
    !hasFilledString(order.firmTypeOther)
  ) {
    return false;
  }
  if (!isYes(order.stageDelivery) && !isNo(order.stageDelivery)) return false;
  if (isYes(order.stageDelivery)) {
    if (!hasFilledString(order.stageDeliveryCount)) return false;
    if (!isYes(order.stagePayment) && !isNo(order.stagePayment)) return false;
    if (isYes(order.stagePayment) && !isYes(order.advancePayment) && !isNo(order.advancePayment)) {
      return false;
    }
  }
  return true;
}

function isSupplyOrderPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isCancelledOrder(file, order) &&
    isFinancialSanctionCompleted(order) &&
    !isSupplyOrderTabComplete(file, order)
  );
}

function isBgCategoryApplicable(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return (
      isYes(order.psbApplicable) &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "pwb") {
    return (
      isYes(file.bg) &&
      (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "psbpwb") return isYes(file.bg) && order.bgCoverageType === "PSB+PWB";
  return false;
}

function getBgReceivedDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgReceivedDate;
  if (normalized === "pwb") return order.pwbBgReceivedDate;
  if (normalized === "psbpwb") return order.combinedBgReceivedDate;
  return undefined;
}

function getBgValidityDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgValidityDate;
  if (normalized === "pwb") return order.pwbBgValidityDate;
  if (normalized === "psbpwb") return order.combinedBgValidityDate;
  return undefined;
}

function getBgReturnDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgReturnDate;
  if (normalized === "pwb") return order.pwbBgReturnDate;
  if (normalized === "psbpwb") return order.combinedBgReturnDate;
  return undefined;
}

function countBgPendingOrders(files: FileRecord[], category: string) {
  return expectedOrderEntries(files).filter(({ file, order }) =>
    isBgPendingOrder(file, order, category),
  ).length;
}

function isBgPendingOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    !isBgReceivedOrder(order, category) &&
    !isCancelledOrder(file, order) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? isFinancialSanctionCompleted(order)
      : hasFilledString(order.materialReceiptDate))
  );
}

function countBgReceivedOrders(files: FileRecord[], category: string) {
  return rawOrderEntries(files).filter(
    ({ file, order }) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgReceivedOrder(order, category) &&
      !isCancelledOrder(file, order),
  ).length;
}

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function countBgReturnedOrders(files: FileRecord[], category: string) {
  return rawOrderEntries(files).filter(({ file, order }) =>
    isBgReturnedOrder(file, order, category),
  ).length;
}

function isBgReturnedOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  return (
    isBgCategoryApplicable(file, order, category) &&
    hasFilledString(getBgReturnDate(order, category))
  );
}

function countBgToBeReturnedOrders(files: FileRecord[], category: string) {
  return rawOrderEntries(files).filter(({ file, order }) =>
    isBgReturnDueOrder(file, order, category),
  ).length;
}

function isBgReturnDueOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  if (
    !isBgCategoryApplicable(file, order, category) ||
    !isBgReceivedOrder(order, category) ||
    hasFilledString(getBgReturnDate(order, category))
  )
    return false;
  if (isYes(order.soCancelled)) return true;
  const validityDate = getBgValidityDate(order, category);
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    !isCancelledOrder(file, order) &&
    (normalizedCategory === "psb"
      ? isPsbReturnPurposeComplete(file, order)
      : hasFilledString(order.paymentDate) &&
        hasFilledString(validityDate) &&
        isBeforeToday(validityDate))
  );
}

function isPsbReturnPurposeComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!isDeliveryInspectionApplicable(file)) {
    const dueDate = getDeliveryPeriodDate(order);
    return hasFilledString(dueDate) && isBeforeToday(dueDate);
  }
  if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    return order.stageDeliveries.every((stage) => hasPsbReturnCompletion(file, stage));
  }
  return hasPsbReturnCompletion(file, order);
}

function hasPaymentDueCompletion(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPaymentDueCompletionDate(file, order));
}

function getPaymentDueCompletionDate(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.ir) ? order.materialReceiptDate : order.jobCompletionDate;
}

function hasPsbReturnCompletion(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPsbReturnCompletionDate(file, order));
}

function getPsbReturnCompletionDate(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.ir) ? order.irReceiptDate : order.jobCompletionDate;
}

function countBgExpiredOrders(files: FileRecord[], category: string) {
  return rawOrderEntries(files).filter(({ file, order }) => isBgExpiredOrder(file, order, category))
    .length;
}

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const validityDate = getBgValidityDate(order, category);
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !isCancelledOrder(file, order) &&
    (normalizedCategory === "psb"
      ? !isPsbReturnPurposeComplete(file, order)
      : !hasFilledString(order.paymentDate)) &&
    hasFilledString(validityDate) &&
    isBeforeToday(validityDate)
  );
}

function isFinancialSanctionCompleted(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.financialSanctionDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    )
  );
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return isPaymentDueByDeliveryOrPeriod(file, order);
}

function isPaymentDueByDeliveryOrPeriod(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasPaymentDueCompletion(file, order);
  const dueDate = getDeliveryPeriodDate(order);
  return hasFilledString(dueDate) && isBeforeToday(dueDate);
}

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((milestone) => milestone.trim()).filter(Boolean)));
}

function getCurrentMonthKey() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function monthMatches(date: string | undefined, monthKey: string) {
  return hasFilledString(date) && date!.slice(0, 7) === monthKey;
}

function monthBefore(date: string | undefined, monthKey: string) {
  return hasFilledString(date) && date!.slice(0, 7) < monthKey;
}

function isDateBefore(date: string | undefined, reference: string | undefined) {
  const dateTime = parseDate(date);
  const referenceTime = parseDate(reference);
  return dateTime !== undefined && referenceTime !== undefined && dateTime < referenceTime;
}

function isBeforeToday(date: string | undefined) {
  return hasFilledString(date) && date! < formatLocalDate(new Date());
}


function parseDate(date: string | undefined) {
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasAmount(value: string | undefined) {
  const text = value?.trim();
  return text ? Number(text.replace(/,/g, "")) > 0 : false;
}

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!value?.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatValuePercent(value: number, total: number) {
  return `${formatMoney(value)} / ${getPercent(value, total)}%`;
}

function getPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function formatMoney(value: number) {
  return formatThousandsAndLakhs(value / 100_000, 2);
}

function formatCount(value: number) {
  return String(value);
}
