import type { Division, FileRecord, SupplyOrderDetail } from "@/lib/files-store";
import {
  effectivePaymentEntries as normalizedPaymentEntries,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getActualPaymentCapital,
  getActualPaymentRevenue,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "@/lib/effective-deliveries";
import { getInrAmount } from "@/lib/money";

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
  { key: "allocatedCapital", label: "Allocated Capital", group: "Finance" },
  { key: "allocatedRevenue", label: "Allocated Revenue", group: "Finance" },
  { key: "intendedCapital", label: "Intended Capital (Value / %)", group: "Finance" },
  { key: "intendedRevenue", label: "Intended Revenue (Value / %)", group: "Finance" },
  { key: "bookedCapital", label: "Booked Capital (Value / %)", group: "Finance" },
  { key: "bookedRevenue", label: "Booked Revenue (Value / %)", group: "Finance" },
  { key: "committedCapital", label: "Committed Capital (Value / %)", group: "Finance" },
  { key: "committedRevenue", label: "Committed Revenue (Value / %)", group: "Finance" },
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
  { key: "soPlaced", label: "S.O. placed", group: "Bidding and S.O." },
  { key: "deliveriesDueThisMonth", label: "No. of deliveries due this month", group: "Delivery" },
  {
    key: "deliveriesCompletedThisMonth",
    label: "No. of deliveries completed this month",
    group: "Delivery",
  },
  { key: "deliveryPeriodValid", label: "Delivery Period valid", group: "Delivery" },
  { key: "deliveryPeriodExpired", label: "Delivery Period expired", group: "Delivery" },
  { key: "deliveryPeriodExtended", label: "Delivery Period extended", group: "Delivery" },
  { key: "totalIrSentToUser", label: "Total IR sent to user", group: "Delivery" },
  { key: "totalIrReceived", label: "Total IR received", group: "Delivery" },
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
  { key: "totalPaymentsMadeThisYear", label: "Total payments made this year", group: "Payment" },
  { key: "actualPaymentCapital", label: "Actual payment Capital", group: "Payment" },
  { key: "actualPaymentRevenue", label: "Actual payment Revenue", group: "Payment" },
  { key: "advancePaymentCount", label: "Advance payment count", group: "Payment" },
  { key: "advancePaymentCapital", label: "Advance payment Capital", group: "Payment" },
  { key: "advancePaymentRevenue", label: "Advance payment Revenue", group: "Payment" },
  {
    key: "totalExpectedPaymentRemainingThisYear",
    label: "Total expected payment remaining this year",
    group: "Payment",
  },
  { key: "liveFilesThisYear", label: "Number of live files of this year", group: "Files" },
  { key: "closedFilesThisYear", label: "Number of closed files of this year", group: "Files" },
  {
    key: "liveFilesPreviousYears",
    label: "Number of live files from previous years",
    group: "Files",
  },
  { key: "cancelledDemands", label: "Cancelled demands", group: "Additional" },
  { key: "soCancelled", label: "S.O. cancelled", group: "Additional" },
  { key: "deliveriesOverdue", label: "Deliveries overdue", group: "Additional" },
  { key: "paymentsOverdue", label: "Payments overdue", group: "Additional" },
  { key: "bgPending", label: "BG pending", group: "Additional" },
  { key: "bgReceived", label: "BG received", group: "Additional" },
  { key: "bgToBeReturned", label: "BG to be returned", group: "Additional" },
  { key: "multipleSupplyOrders", label: "Multiple S.O.", group: "Additional" },
  { key: "ld", label: "LD", group: "Additional" },
  { key: "dpExtension", label: "D.P. extension", group: "Additional" },
  { key: "dpExtensionCount", label: "Extension count", group: "Additional" },
  { key: "revisedDp", label: "Revised D.P.", group: "Additional" },
  {
    key: "totalSoValuePlacedThisFy",
    label: "Total S.O. value placed this FY",
    group: "Additional",
  },
  { key: "totalUnpaidSoValue", label: "Total unpaid S.O. value", group: "Additional" },
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
      label:
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : (option?.label ?? candidate.key),
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
  previousYearFiles: FileRecord[],
  financialYear: string,
) {
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
  const fyRange = getFinancialYearRange(financialYear);
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
  const paymentOrders = normalizedPaymentEntries(files);
  const actualPaymentEntriesThisYear = paymentOrders.filter(
    ({ file, order }) =>
      !isCancelledOrder(file, order) && dateInFinancialYear(order.paymentDate, fyRange),
  );
  const advancePaymentEntries = paymentOrders.filter(
    ({ file, order }) =>
      !isCancelledOrder(file, order) && order.stageDeliveryLabel === "Advance Payment",
  );
  const liveFiles = files.filter((file) => !isCancelledDemand(file) && !isFileClosed(file));
  const closedFiles = nonCancelledFiles.filter(isFileClosed);
  const livePreviousYearFiles = previousYearFiles.filter(
    (file) => !isCancelledDemand(file) && !isFileClosed(file),
  );

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
    rqaVettingDone: countFiles(nonCancelledFiles, (file) =>
      hasFilledString(file.rqaApprovalDate),
    ),
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
    soPlaced: formatCount(rawActiveOrders.filter(({ order }) => hasSupplyOrderDate(order)).length),
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
    deliveryPeriodValid: formatCount(
      orders.filter(({ file, order }) => isValidDeliveryPeriodEntry(file, order)).length,
    ),
    deliveryPeriodExpired: formatCount(
      orders.filter(({ file, order }) => isExpiredDeliveryPeriodEntry(file, order)).length,
    ),
    deliveryPeriodExtended: formatCount(
      orders.filter(({ file, order }) => isExtendedDeliveryPeriodEntry(file, order)).length,
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
      actualPaymentEntriesThisYear.reduce(
        (sum, { file, order }) => sum + getActualPaymentTotal(file, order),
        0,
      ),
    ),
    actualPaymentCapital: formatMoney(
      actualPaymentEntriesThisYear.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentCapital(order), file) ?? 0),
        0,
      ),
    ),
    actualPaymentRevenue: formatMoney(
      actualPaymentEntriesThisYear.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentRevenue(order), file) ?? 0),
        0,
      ),
    ),
    advancePaymentCount: formatCount(advancePaymentEntries.length),
    advancePaymentCapital: formatMoney(
      advancePaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentCapital(order), file) ?? 0),
        0,
      ),
    ),
    advancePaymentRevenue: formatMoney(
      advancePaymentEntries.reduce(
        (sum, { file, order }) => sum + (getInrAmount(getActualPaymentRevenue(order), file) ?? 0),
        0,
      ),
    ),
    totalExpectedPaymentRemainingThisYear: formatMoney(
      sumOrders(files, ({ file, order }) =>
        !isCancelledOrder(file, order) &&
        dateInFinancialYear(getDeliveryPeriodDate(order), fyRange) &&
        !hasFilledString(order.materialReceiptDate) &&
        !hasFilledString(order.paymentDate)
          ? getOrderTotal(file, order)
          : 0,
      ),
    ),
    liveFilesThisYear: formatCount(liveFiles.length),
    closedFilesThisYear: formatCount(closedFiles.length),
    liveFilesPreviousYears: formatCount(livePreviousYearFiles.length),
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
    bgPending: formatCount(
      rawOrders.filter(
        ({ file, order }) =>
          isYes(file.bg) &&
          !isCancelledOrder(file, order) &&
          hasSupplyOrderDate(order) &&
          !hasFilledString(order.bgValidityDate),
      ).length,
    ),
    bgReceived: formatCount(
      rawOrders.filter(
        ({ file, order }) =>
          isYes(file.bg) && !isCancelledOrder(file, order) && hasFilledString(order.bgValidityDate),
      ).length,
    ),
    bgToBeReturned: formatCount(
      rawOrders.filter(
        ({ file, order }) =>
          isYes(file.bg) &&
          !isCancelledOrder(file, order) &&
          hasSupplyOrderDate(order) &&
          hasFilledString(order.bgValidityDate) &&
          isBeforeToday(order.bgValidityDate) &&
          !hasFilledString(order.bgReturnDate),
      ).length,
    ),
    multipleSupplyOrders: formatCount(
      nonCancelledFiles.filter(
        (file) =>
          rawSupplyOrders(file).filter((order) => !isCancelledOrder(file, order)).length > 1,
      ).length,
    ),
    ld: formatCount(
      rawActiveOrders.filter(({ order }) => isYes(order.ld)).length,
    ),
    dpExtension: formatCount(
      rawActiveOrders.filter(({ order }) => isYes(order.dpExtension)).length,
    ),
    dpExtensionCount: formatCount(
      rawActiveOrders.reduce((sum, { order }) => sum + (parseAmount(order.dpExtensionCount) ?? 0), 0),
    ),
    revisedDp: formatCount(
      rawActiveOrders.filter(({ order }) => hasFilledString(order.revisedDp)).length,
    ),
    totalSoValuePlacedThisFy: formatMoney(
      rawActiveOrders.reduce(
        (sum, { file, order }) =>
          sum + (dateInFinancialYear(order.soDate, fyRange) ? getOrderTotal(file, order) : 0),
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
    files.filter((file) => !specialFileTypes.has(file.fileType?.trim().toLowerCase() ?? ""))
      .length,
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
  if (supplyOrders.length === 0) return isYes(file.soCancelled);
  return supplyOrders.every((order) => isYes(order.soCancelled));
}

function isDemandCancelled(file: FileRecord) {
  return isYes(file.demandCancelled);
}

function isCancelledOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isLegacySoCancelledFile(file) || isYes(order.soCancelled);
}

function isLegacySoCancelledFile(file: FileRecord) {
  return isYes(file.soCancelled) && (file.supplyOrders?.length ?? 0) === 0;
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
  return (
    hasFilledString(order.soDate) || hasFilledString(order.soNo) || hasFilledString(order.gemSoNo)
  );
}

function getCurrentMonthKey() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function getFinancialYearRange(financialYear: string) {
  const startYear = readFinancialYearStart(financialYear) ?? new Date().getFullYear();
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

function readFinancialYearStart(financialYear: string) {
  const match = financialYear.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function dateInFinancialYear(date: string | undefined, range: { start: string; end: string }) {
  return hasFilledString(date) && date! >= range.start && date! <= range.end;
}

function monthMatches(date: string | undefined, monthKey: string) {
  return hasFilledString(date) && date!.slice(0, 7) === monthKey;
}

function monthBefore(date: string | undefined, monthKey: string) {
  return hasFilledString(date) && date!.slice(0, 7) < monthKey;
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
  return Math.round(value).toLocaleString("en-IN");
}

function formatCount(value: number) {
  return String(value);
}
