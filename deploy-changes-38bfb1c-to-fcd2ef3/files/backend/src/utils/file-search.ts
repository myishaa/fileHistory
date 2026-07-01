import type { FileRecord, SupplyOrderDetail } from "../types.js";

export type FileSearchParams = {
  yearFilter?: string;
  indentor?: string;
  divisionFilter?: string;
  valueFrom?: string;
  valueTo?: string;
  soValueFrom?: string;
  soValueTo?: string;
  soCapitalOnly?: boolean;
  soRevenueOnly?: boolean;
  capitalOnly?: boolean;
  revenueOnly?: boolean;
  description?: string;
  firm?: string;
  selectedModes?: string[];
  highValue?: boolean;
  gte?: boolean;
  ad?: boolean;
  rqa?: boolean;
  ifaFilter?: boolean;
  psbFilter?: boolean;
  bgFilter?: boolean;
  rfpVettingFilter?: boolean;
  refloat?: boolean;
  cnc?: boolean;
  tcec?: boolean;
  dpFrom?: string;
  dpTo?: string;
  rstFilter?: boolean;
  demandCancelledFilter?: boolean;
  soCancelledFilter?: boolean;
  freeText?: string;
  freeDate?: string;
  dashboardFilter?: string;
  analyticsType?: "firm" | "indentor";
  analyticsNames?: string[];
  sortColumnKey?: string;
  sortDirection?: "asc" | "desc";
  divisionWiseSort?: boolean;
};

type FileKey = Exclude<
  keyof FileRecord,
  | "id"
  | "createdAt"
  | "invitedFirms"
  | "bidderFirms"
  | "supplyOrders"
  | "remarks"
  | "completedMilestones"
>;
type SupplyOrderKey = keyof SupplyOrderDetail;
const fileClosedMilestone = "File Closed";

const sortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const supplyOrderKeys = [
  "soNo",
  "gemSoNo",
  "soDate",
  "soValueCapital",
  "soValueRevenue",
  "dpDate",
  "firm",
  "bgValidityDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "materialReceiptDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "bgReturnDate",
  "demandCancelled",
  "soCancelled",
  "soCancelledDate",
] satisfies FileKey[];
const supplyOrderKeySet = new Set<string>(supplyOrderKeys);

const searchableFileKeys = [
  "title",
  "division",
  "officer",
  "imms",
  "date",
  "year",
  "uniqueCode",
  "receivedDate",
  "scrutinyDate",
  "scrutinyResponseDate",
  "scrutinyCompletionDate",
  "immsDate",
  "fileNo",
  "indentor",
  "demandDescription",
  "valueCapital",
  "valueRevenue",
  "currency",
  "exchangeRate",
  "gte",
  "tcec",
  "mode",
  "gem",
  "highValue",
  "ad",
  "rqa",
  "ifa",
  "psb",
  "bg",
  "rfpVetting",
  "highValueMeetingDate",
  "highValueMinutesDate",
  "preTcecDate",
  "preTcecMinutesDate",
  "preTcecCommitteeNo",
  "adVettingDate",
  "rqaApprovalDate",
  "ifaSentDate",
  "ifaFinalDate",
  "cfaSentDate",
  "cfaDate",
  "gemUndertakingDate",
  "rfpVettingInitiationDate",
  "rfpVettingApprovalDate",
  "tenderLive",
  "bidNumber",
  "bidDate",
  "bidOpeningDate",
  "bidOpened",
  "refloat",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatBiddingDate",
  "refloatBidOpeningDate",
  "rst",
  "biddingStageOver",
  "cncDate",
  "cncApprovalDate",
  "noOfSo",
  "currentMilestone",
  ...supplyOrderKeys,
] satisfies FileKey[];

const dateFileKeys = searchableFileKeys.filter(
  (key) =>
    key.toLowerCase().includes("date") ||
    key === "revisedDp" ||
    key === "dpDate" ||
    key === "bgValidityDate" ||
    key === "bgReturnDate",
);

const supplyOrderDateKeys = new Set<SupplyOrderKey>([
  "soDate",
  "bgValidityDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
]);

const milestoneDefinitions = [
  {
    key: "scrutiny",
    previous: "receivedDate",
    reviewed: "scrutinyDate",
    current: "scrutinyCompletionDate",
  },
  {
    key: "highValue",
    previous: "scrutinyCompletionDate",
    reviewed: "highValueMeetingDate",
    current: "highValueMinutesDate",
    applies: (file: FileRecord) => isYes(file.highValue),
  },
  {
    key: "tcec",
    previous: "highValueMinutesDate",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "ad",
    previous: "preTcecMinutesDate",
    current: "adVettingDate",
    applies: (file: FileRecord) => isYes(file.ad),
  },
  {
    key: "rqa",
    previous: "adVettingDate",
    current: "rqaApprovalDate",
    applies: (file: FileRecord) => isYes(file.rqa),
  },
  { key: "control", previous: "rqaApprovalDate", current: "immsDate" },
  {
    key: "ifa",
    previous: "immsDate",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file: FileRecord) => isYes(file.ifa),
  },
  { key: "cfa", previous: "ifaFinalDate", reviewed: "cfaSentDate", current: "cfaDate" },
  { key: "bidding", previous: "cfaDate", current: "biddingStageOver" },
  {
    key: "postTcec",
    previous: "biddingStageOver",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "cnc",
    previous: "postTcecMinutesDate",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  { key: "supplyOrder", previous: "postTcecMinutesDate", current: "soDate" },
  {
    key: "bankGuarantee",
    previous: "soDate",
    current: "bgValidityDate",
    applies: (file: FileRecord) => isYes(file.bg),
  },
  { key: "payment", previous: "bgValidityDate", current: "paymentDate" },
] satisfies Array<{
  key: string;
  previous: FileKey | SupplyOrderKey;
  reviewed?: FileKey | SupplyOrderKey;
  current: FileKey | SupplyOrderKey;
  applies?: (file: FileRecord) => boolean;
}>;

export function searchFiles(files: FileRecord[], params: FileSearchParams) {
  const minValue = parseAmount(params.valueFrom);
  const maxValue = parseAmount(params.valueTo);
  const minSoValue = parseAmount(params.soValueFrom);
  const maxSoValue = parseAmount(params.soValueTo);
  const selectedModes = params.selectedModes ?? [];
  const analyticsNameSet = new Set((params.analyticsNames ?? []).map(normalizeAnalyticsName));

  const filtered = files.filter((file) => {
    if (params.yearFilter && !includesText(file.year, params.yearFilter)) return false;
    if (params.dashboardFilter && !matchesDashboardFilter(file, params.dashboardFilter))
      return false;
    if (
      analyticsNameSet.size > 0 &&
      params.analyticsType === "indentor" &&
      !analyticsNameSet.has(
        normalizeAnalyticsName(getAnalyticsName(file.indentor, "Unassigned indentor")),
      )
    ) {
      return false;
    }
    if (
      analyticsNameSet.size > 0 &&
      params.analyticsType === "firm" &&
      !fileSupplyOrders(file).some((order) =>
        analyticsNameSet.has(
          normalizeAnalyticsName(getAnalyticsName(order.firm, "Unassigned firm")),
        ),
      )
    ) {
      return false;
    }
    if (params.indentor && !includesText(file.indentor, params.indentor)) return false;
    if (params.divisionFilter && !includesText(file.division, params.divisionFilter)) return false;
    if (params.description && !includesText(file.demandDescription, params.description))
      return false;
    if (
      params.firm &&
      !fileSupplyOrders(file).some((order) => includesText(order.firm, params.firm ?? ""))
    ) {
      return false;
    }
    if (
      selectedModes.length > 0 &&
      !selectedModes.includes((file.mode ?? "").trim().toUpperCase())
    ) {
      return false;
    }
    if (params.highValue && !isYes(file.highValue)) return false;
    if (params.gte && !isYes(file.gte)) return false;
    if (params.ad && !isYes(file.ad)) return false;
    if (params.rqa && !isYes(file.rqa)) return false;
    if (params.ifaFilter && !isYes(file.ifa)) return false;
    if (params.psbFilter && !isYes(file.psb)) return false;
    if (params.bgFilter && !isYes(file.bg)) return false;
    if (params.rfpVettingFilter && !isYes(file.rfpVetting)) return false;
    if (
      params.refloat &&
      !isYes(file.refloat) &&
      !hasAny(file, ["refloatBiddingDate", "refloatBidOpeningDate"])
    ) {
      return false;
    }
    if (params.cnc && !hasAny(file, ["cncDate", "cncApprovalDate"])) return false;
    if (params.tcec && !isTcecFile(file)) return false;
    if (params.rstFilter && !isYes(file.rst)) return false;
    if (
      params.demandCancelledFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.demandCancelled))
    ) {
      return false;
    }
    if (
      params.soCancelledFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.soCancelled))
    ) {
      return false;
    }
    if (!matchesValueType(file, Boolean(params.capitalOnly), Boolean(params.revenueOnly)))
      return false;
    if (!matchesValueRange(file, minValue, maxValue)) return false;
    if (
      !matchesSoValueRange(
        file,
        minSoValue,
        maxSoValue,
        Boolean(params.soCapitalOnly),
        Boolean(params.soRevenueOnly),
      )
    ) {
      return false;
    }
    if (
      !fileSupplyOrders(file).some((order) =>
        matchesDateRange(getDeliveryPeriodDate(order), params.dpFrom ?? "", params.dpTo ?? ""),
      )
    ) {
      return false;
    }
    if (params.freeText && !allSearchText(file).includes(params.freeText.trim().toLowerCase()))
      return false;
    if (params.freeDate && !matchesFreeDate(file, params.freeDate)) return false;

    return true;
  });

  return sortFiles(
    filtered,
    params.sortColumnKey ?? "none",
    Boolean(params.divisionWiseSort),
    params.sortDirection ?? "asc",
  );
}

function parseAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getInrAmount(value: string | undefined, file: FileRecord) {
  const amount = parseAmount(value);
  if (amount === undefined) return undefined;

  const currency = (file.currency ?? "INR").trim().toUpperCase();
  if (!currency || currency === "INR") return amount;

  const exchangeRate = parseAmount(file.exchangeRate);
  if (exchangeRate === undefined || exchangeRate <= 0) return undefined;

  return amount * exchangeRate;
}

function includesText(value: string | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function hasNonZeroAmount(value: string | undefined) {
  const amount = parseAmount(value);
  return amount !== undefined && amount !== 0;
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasDate(date: string | undefined) {
  return parseLocalDateTime(date ?? "") !== undefined;
}

function parseLocalDateTime(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
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

function fileSupplyOrders(file: FileRecord) {
  const rows =
    file.supplyOrders
      ?.map((row) => ({ ...row }))
      .filter((row) => Object.values(row).some((value) => Boolean(String(value ?? "").trim()))) ??
    [];
  if (rows.length) return rows;

  const legacy: SupplyOrderDetail = {
    soNo: file.soNo,
    gemSoNo: file.gemSoNo,
    soDate: file.soDate,
    soValueCapital: file.soValueCapital,
    soValueRevenue: file.soValueRevenue,
    dpDate: file.dpDate,
    firm: file.firm,
    bgValidityDate: file.bgValidityDate,
    dpExtension: file.dpExtension,
    dpExtensionCount: file.dpExtensionCount,
    ld: file.ld,
    revisedDp: file.revisedDp,
    materialReceiptDate: file.materialReceiptDate,
    irPreparationDate: file.irPreparationDate,
    irReceiptDate: file.irReceiptDate,
    billPreparationDate: file.billPreparationDate,
    billSentForPaymentDate: file.billSentForPaymentDate,
    paymentDate: file.paymentDate,
    paymentMode: file.paymentMode,
    bgReturnDate: file.bgReturnDate,
    demandCancelled: file.demandCancelled,
    soCancelled: file.soCancelled,
    soCancelledDate: file.soCancelledDate,
  };
  return Object.values(legacy).some((value) => Boolean(String(value ?? "").trim())) ? [legacy] : [];
}

function isCancelledFile(file: FileRecord) {
  return (
    isYes(file.demandCancelled) ||
    isYes(file.soCancelled) ||
    fileSupplyOrders(file).some((order) => isYes(order.demandCancelled) || isYes(order.soCancelled))
  );
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isYes(file.demandCancelled) ||
    isYes(file.soCancelled) ||
    isYes(order.demandCancelled) ||
    isYes(order.soCancelled)
  );
}

function getFirmCount(
  rows: Array<{ firmName?: string; city?: string; emailId?: string }> | undefined,
) {
  return (
    rows
      ?.map((row) => ({
        firmName: row.firmName?.trim() || "",
        city: row.city?.trim() || "",
        emailId: row.emailId?.trim() || "",
      }))
      .filter((row) => row.firmName || row.city || row.emailId).length ?? 0
  );
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function getNoOfSo(file: FileRecord) {
  return String(fileSupplyOrders(file).filter(hasSupplyOrderDate).length);
}

function getSupplyOrderFieldValue(file: FileRecord, key: SupplyOrderKey) {
  const rows = fileSupplyOrders(file);
  return rows
    .map((order, index) => {
      const value = String(order[key] ?? "");
      if (!value.trim()) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function hasAny(file: FileRecord, keys: Array<FileKey | SupplyOrderKey>) {
  return keys.some((key) =>
    isSupplyOrderKey(key)
      ? fileSupplyOrders(file).some((order) => Boolean(order[key as SupplyOrderKey]))
      : Boolean(file[key as FileKey]),
  );
}

function isTcecFile(file: FileRecord) {
  return (
    isYes(file.tcec) ||
    hasAny(file, ["preTcecDate", "preTcecMinutesDate", "postTcecDate", "postTcecMinutesDate"])
  );
}

function matchesValueRange(
  file: FileRecord,
  minValue: number | undefined,
  maxValue: number | undefined,
) {
  if (minValue === undefined && maxValue === undefined) return true;
  const amounts = [
    getInrAmount(file.valueCapital, file),
    getInrAmount(file.valueRevenue, file),
  ].filter((amount): amount is number => amount !== undefined);
  if (amounts.length === 0) return false;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (minValue !== undefined && total < minValue) return false;
  if (maxValue !== undefined && total > maxValue) return false;
  return true;
}

function matchesSoValueRange(
  file: FileRecord,
  minValue: number | undefined,
  maxValue: number | undefined,
  capitalOnly: boolean,
  revenueOnly: boolean,
) {
  if (minValue === undefined && maxValue === undefined && !capitalOnly && !revenueOnly) return true;
  const includeCapital = !revenueOnly || capitalOnly;
  const includeRevenue = !capitalOnly || revenueOnly;
  const amounts = fileSupplyOrders(file).flatMap((order) =>
    [
      includeCapital ? parseAmount(order.soValueCapital) : undefined,
      includeRevenue ? parseAmount(order.soValueRevenue) : undefined,
    ].filter((amount): amount is number => amount !== undefined),
  );
  if (amounts.length === 0) return false;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (minValue !== undefined && total < minValue) return false;
  if (maxValue !== undefined && total > maxValue) return false;
  return true;
}

function matchesValueType(file: FileRecord, capitalOnly: boolean, revenueOnly: boolean) {
  if (!capitalOnly && !revenueOnly) return true;
  const hasCapital = hasNonZeroAmount(file.valueCapital);
  const hasRevenue = hasNonZeroAmount(file.valueRevenue);
  if (capitalOnly && revenueOnly) return hasCapital || hasRevenue;
  if (capitalOnly) return hasCapital;
  return hasRevenue;
}

function matchesDateRange(date: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function matchesFreeDate(file: FileRecord, freeDate: string) {
  return dateFileKeys.some((key) => {
    if (isSupplyOrderKey(key)) {
      return fileSupplyOrders(file).some((order) => order[key as SupplyOrderKey] === freeDate);
    }
    return file[key as FileKey] === freeDate;
  });
}

function allSearchText(file: FileRecord) {
  const directText = searchableFileKeys
    .map((key) =>
      isSupplyOrderKey(key)
        ? getSupplyOrderFieldValue(file, key as SupplyOrderKey)
        : file[key as FileKey],
    )
    .filter(Boolean)
    .join(" ");
  const supplyOrderText = fileSupplyOrders(file)
    .flatMap((order) => Object.values(order))
    .filter(Boolean)
    .join(" ");
  const remarkText =
    file.remarks?.map((remark) => `${remark.section} ${remark.text}`).join(" ") ?? "";
  const firmText = [getFirmCount(file.invitedFirms), getFirmCount(file.bidderFirms)].join(" ");
  return `${directText} ${supplyOrderText} ${remarkText} ${firmText}`.toLowerCase();
}

function sortFiles(
  files: FileRecord[],
  sortColumnKey: string,
  divisionWiseSort: boolean,
  sortDirection: "asc" | "desc",
) {
  const indexed = files.map((file, index) => ({ file, index }));
  const sorted = [...indexed].sort((a, b) => {
    if (divisionWiseSort) {
      const divisionCompare = compareSortValues(a.file.division, b.file.division);
      if (divisionCompare !== 0) return divisionCompare;
    }

    if (sortColumnKey !== "none") {
      const columnCompare = compareSortValues(
        getSortColumnValue(a.file, sortColumnKey),
        getSortColumnValue(b.file, sortColumnKey),
      );
      if (columnCompare !== 0) return sortDirection === "asc" ? columnCompare : -columnCompare;
    }

    return a.index - b.index;
  });

  return sorted.map(({ file }) => file);
}

function getSortColumnValue(file: FileRecord, key: string) {
  if (key === "noOfSo") return getNoOfSo(file);
  if (key === "invitedFirms") return String(getFirmCount(file.invitedFirms));
  if (key === "bidderFirms") return String(getFirmCount(file.bidderFirms));
  if (isSupplyOrderKey(key)) {
    return getSupplyOrderFieldValue(file, key as SupplyOrderKey);
  }
  return String(file[key as FileKey] ?? "");
}

function isSupplyOrderKey(key: string): key is SupplyOrderKey {
  return supplyOrderKeySet.has(key);
}

function compareSortValues(a: string | undefined, b: string | undefined) {
  const aValue = (a ?? "").trim();
  const bValue = (b ?? "").trim();
  if (!aValue && !bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return sortCollator.compare(aValue, bValue);
}

function isFileTenderLive(file: FileRecord) {
  return isYes(file.tenderLive);
}

function isBidOverdue(file: FileRecord) {
  return (
    isNo(file.bidOpened) &&
    (isDateBeforeToday(file.bidOpeningDate) || isDateBeforeToday(file.refloatBidOpeningDate))
  );
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isYes(order.soCancelled),
  );
}

function isBgToBeReceived(file: FileRecord) {
  return isYes(file.bg) && hasAny(file, ["soDate"]) && !hasAny(file, ["bgValidityDate"]);
}

function isBgToBeReturned(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isYes(file.bg) &&
      Boolean(order.bgValidityDate) &&
      isDateBeforeToday(order.bgValidityDate) &&
      !order.bgReturnDate,
  );
}

function isDpExpired(file: FileRecord) {
  return fileSupplyOrders(file).some((order) => isDateBeforeToday(getDeliveryPeriodDate(order)));
}

function isDeliveryOverdue(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isOverdueDeliveryOrder);
}

function isDeliveryDueToday(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isDueTodayDeliveryOrder);
}

function isDeliveryUpcoming(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isUpcomingDeliveryOrder);
}

function isDeliveryDeliveredLate(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isLateDeliveredOrder);
}

function isDeliveryCompleted(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isDueDeliveryOrder);
}

function isDeliveryActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
}

function isCompletedDeliveryOrder(order: SupplyOrderDetail) {
  return hasSupplyOrderDate(order) && hasFilledString(order.materialReceiptDate);
}

function isDueDeliveryOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    !hasFilledString(order.materialReceiptDate) &&
    !isYes(order.soCancelled)
  );
}

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function isOverdueDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateBeforeToday(getDeliveryDueDate(order));
}

function isDueTodayDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateToday(getDeliveryDueDate(order));
}

function isUpcomingDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateAfterToday(getDeliveryDueDate(order));
}

function isLateDeliveredOrder(order: SupplyOrderDetail) {
  const dueTime = parseLocalDateTime(getDeliveryDueDate(order) ?? "");
  const receiptTime = parseLocalDateTime(order.materialReceiptDate ?? "");
  return (
    isCompletedDeliveryOrder(order) &&
    dueTime !== undefined &&
    receiptTime !== undefined &&
    receiptTime > dueTime
  );
}

function isDeliveryPeriodValid(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isValidDeliveryPeriodOrder);
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExpiredDeliveryPeriodOrder);
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExtendedDeliveryPeriodOrder);
}

function isDeliveryPeriodActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
}

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
}

function isBankGuaranteeEligible(file: FileRecord) {
  return (
    isYes(file.bg) &&
    fileSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isValidDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExpiredDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateBeforeToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExtendedDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    hasFilledString(order.revisedDp) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function isPaymentDue(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => Boolean(order.materialReceiptDate) && !order.paymentDate,
  );
}

function isIrPreparationPending(file: FileRecord) {
  return (
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasSupplyOrderDate(order) &&
        hasFilledString(order.materialReceiptDate) &&
        !hasFilledString(order.irPreparationDate) &&
        !isSupplyOrderCancelled(file, order),
    )
  );
}

function isIrReceiptPending(file: FileRecord) {
  return (
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasFilledString(order.irPreparationDate) &&
        !hasFilledString(order.irReceiptDate) &&
        !isSupplyOrderCancelled(file, order),
    )
  );
}

function isIrCompleted(file: FileRecord) {
  return (
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) => hasFilledString(order.irReceiptDate) && !isSupplyOrderCancelled(file, order),
    )
  );
}

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime > todayTime;
}

function isDateToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime === todayTime;
}

function isDelayStatusMatch(file: FileRecord, thresholdDays: number, selectedMilestoneKey: string) {
  const milestone = milestoneDefinitions.find((item) => isManualActiveMilestone(file, item));
  if (!milestone) return false;
  if (selectedMilestoneKey !== "all" && milestone.key !== selectedMilestoneKey) return false;
  if (isMilestoneComplete(file, milestone)) return false;

  const stageStartDate = getMilestoneStageStartDate(file, milestone);
  const daysInStage = getDaysSinceDate(stageStartDate);
  return daysInStage !== undefined && daysInStage > thresholdDays;
}

function getMilestoneStageStartDate(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (milestone.reviewed) {
    const reviewedDate = getFieldDateValue(file, milestone.reviewed);
    if (reviewedDate) return reviewedDate;
  }

  const previousMilestone = getPreviousApplicableMilestone(file, milestone);
  if (previousMilestone) return getFieldDateValue(file, previousMilestone.current);
  return getFieldDateValue(file, "receivedDate") ?? getFieldDateValue(file, "date");
}

function getPreviousApplicableMilestone(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone;
}

function getFieldDateValue(file: FileRecord, key: FileKey | SupplyOrderKey) {
  if (supplyOrderDateKeys.has(key as SupplyOrderKey)) {
    return getEarliestSupplyOrderDate(file, key as SupplyOrderKey);
  }
  const value = file[key as FileKey];
  return typeof value === "string" && hasDate(value) ? value : undefined;
}

function getEarliestSupplyOrderDate(file: FileRecord, key: SupplyOrderKey) {
  return fileSupplyOrders(file)
    .map((order) => String(order[key] ?? ""))
    .filter(hasDate)
    .sort((a, b) => a.localeCompare(b))[0];
}

function getDaysSinceDate(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return undefined;
  return Math.floor((todayTime - dateTime) / 86_400_000);
}

function getDelayThresholdDays(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function addDays(date: string | undefined, days: number) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function readCashOutgoFilter(filter: string) {
  const [, mode, rawMonthKey, rawOffsetDays, rawFromDate, rawToDate, rawAsOfDate] =
    filter.split(":");
  const monthKey = decodeURIComponent(rawMonthKey ?? "");
  const offsetDays = Number.parseInt(rawOffsetDays ?? "0", 10);
  const fromDate = decodeURIComponent(rawFromDate ?? "");
  const toDate = decodeURIComponent(rawToDate ?? "");
  const asOfDate = decodeURIComponent(rawAsOfDate ?? "");
  const validModes = [
    "expectedDp",
    "expectedReceipt",
    "expectedReceiptPendingBill",
    "billPreparation",
    "billSent",
    "actual",
  ];
  if (
    !validModes.includes(mode) ||
    !/^\d{4}-\d{2}$/.test(monthKey) ||
    !Number.isFinite(offsetDays) ||
    offsetDays < 0 ||
    (fromDate && !hasDate(fromDate)) ||
    (toDate && !hasDate(toDate)) ||
    (asOfDate && !hasDate(asOfDate))
  ) {
    return undefined;
  }
  return {
    mode,
    monthKey,
    offsetDays,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    asOfDate: asOfDate || undefined,
  };
}

function monthMatches(date: string | undefined, monthKey: string) {
  return hasDate(date) && date?.slice(0, 7) === monthKey;
}

function dateInRange(date: string | undefined, fromDate: string | undefined, toDate: string | undefined) {
  if (!hasDate(date)) return false;
  if (fromDate && date! < fromDate) return false;
  if (toDate && date! > toDate) return false;
  return true;
}

function isOnOrBefore(date: string | undefined, limit: string | undefined) {
  return hasFilledString(date) && (!limit || date! <= limit);
}

function isMissingOrAfter(date: string | undefined, limit: string | undefined) {
  return !hasFilledString(date) || Boolean(limit && date! > limit);
}

function isCashOutgoFilterMatch(file: FileRecord, filter: string) {
  const parsed = readCashOutgoFilter(filter);
  if (!parsed || isCancelledFile(file)) return false;
  return fileSupplyOrders(file).some((order) => {
    const rangeMatches = (date: string | undefined) =>
      monthMatches(date, parsed.monthKey) && dateInRange(date, parsed.fromDate, parsed.toDate);
    const toDate = parsed.toDate ?? parsed.asOfDate;
    if (parsed.mode === "expectedDp") {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      const cashOutgoDate = addDays(deliveryPeriodDate, parsed.offsetDays);
      return (
        hasFilledString(deliveryPeriodDate) &&
        !isYes(order.soCancelled) &&
        (parsed.asOfDate
          ? isMissingOrAfter(order.materialReceiptDate, parsed.asOfDate)
          : !hasFilledString(order.materialReceiptDate)) &&
        (parsed.asOfDate
          ? isMissingOrAfter(order.paymentDate, parsed.asOfDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "expectedReceipt") {
      const cashOutgoDate = addDays(order.materialReceiptDate, parsed.offsetDays);
      return (
        hasFilledString(order.materialReceiptDate) &&
        (parsed.asOfDate ? isOnOrBefore(order.materialReceiptDate, parsed.asOfDate) : true) &&
        (parsed.asOfDate
          ? isMissingOrAfter(order.paymentDate, parsed.asOfDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "expectedReceiptPendingBill") {
      const cashOutgoDate = addDays(order.materialReceiptDate, parsed.offsetDays);
      return (
        hasFilledString(order.materialReceiptDate) &&
        isOnOrBefore(order.materialReceiptDate, toDate) &&
        (toDate
          ? isMissingOrAfter(order.billPreparationDate, toDate)
          : !hasFilledString(order.billPreparationDate)) &&
        (toDate ? isMissingOrAfter(order.paymentDate, toDate) : !hasFilledString(order.paymentDate)) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "billPreparation") {
      return (
        hasFilledString(order.materialReceiptDate) &&
        hasFilledString(order.billPreparationDate) &&
        isOnOrBefore(order.materialReceiptDate, toDate) &&
        isOnOrBefore(order.billPreparationDate, toDate) &&
        (toDate
          ? isMissingOrAfter(order.billSentForPaymentDate, toDate)
          : !hasFilledString(order.billSentForPaymentDate)) &&
        (toDate ? isMissingOrAfter(order.paymentDate, toDate) : !hasFilledString(order.paymentDate)) &&
        rangeMatches(order.billPreparationDate)
      );
    }
    if (parsed.mode === "billSent") {
      return (
        hasFilledString(order.billSentForPaymentDate) &&
        isOnOrBefore(order.billSentForPaymentDate, toDate) &&
        (toDate ? isMissingOrAfter(order.paymentDate, toDate) : !hasFilledString(order.paymentDate)) &&
        rangeMatches(order.billSentForPaymentDate)
      );
    }
    return (
      hasFilledString(order.paymentDate) &&
      !(isYes(order.soCancelled) && hasFilledString(order.soCancelledDate)) &&
      rangeMatches(order.paymentDate)
    );
  });
}

function isPendingMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (isCancelledFile(file)) return false;
  if (milestone.reviewed) {
    return (
      isManualActiveMilestone(file, milestone) &&
      !hasMilestoneDate(file, milestone.reviewed) &&
      !isMilestoneComplete(file, milestone)
    );
  }
  return isManualActiveMilestone(file, milestone) && !isMilestoneComplete(file, milestone);
}

function isClearedMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return isEligibleMilestone(file, milestone) && isMilestoneComplete(file, milestone);
}

function isEligibleMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (isCancelledFile(file)) return false;
  return (
    isMilestoneApplicable(file, milestone) && isPreviousApplicableMilestoneComplete(file, milestone)
  );
}

function isMilestoneApplicable(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return milestone.applies ? milestone.applies(file) : true;
}

function isPreviousApplicableMilestoneComplete(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (milestone.key === "bankGuarantee") return isSupplyOrderPlaced(file);
  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") return isYes(file.biddingStageOver);
  return hasMilestoneDate(file, milestone.current);
}

function isMilestoneReviewed(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (isCancelledFile(file)) return false;
  if (!milestone.reviewed) return false;
  return (
    isManualActiveMilestone(file, milestone) &&
    hasMilestoneDate(file, milestone.reviewed) &&
    !isMilestoneComplete(file, milestone)
  );
}

function isManualActiveMilestone(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (isCancelledFile(file)) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  return getMilestoneLabelAliases(milestone.key).some(
    (label) => current === normalizeMilestoneName(label),
  );
}

function getMilestoneLabelAliases(key: string) {
  const labels: Record<string, string> = {
    scrutiny: "Scrutiny",
    highValue: "High Value",
    tcec: "Pre-TCEC",
    ad: "AD",
    rqa: "R&QA",
    control: "Controlling",
    ifa: "IFA",
    cfa: "CFA",
    bidding: "Bidding",
    postTcec: "Post-TCEC",
    cnc: "CNC",
    supplyOrder: "Supply Order",
    bankGuarantee: "Bank Guarantee",
    payment: "Payment",
  };
  return key === "control" ? [labels[key], "Controlled"] : [labels[key] ?? key];
}

function getAnalyticsName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function normalizeAnalyticsName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
  );
}

function hasMilestoneDate(file: FileRecord, key: FileKey | SupplyOrderKey) {
  if (supplyOrderDateKeys.has(key as SupplyOrderKey)) {
    return fileSupplyOrders(file).some((order) => hasFilledString(order[key as SupplyOrderKey]));
  }
  const value = file[key as FileKey];
  return typeof value === "string" && hasFilledString(value);
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (filter.startsWith("delayFile:")) return file.id === filter.slice("delayFile:".length);
  if (filter.startsWith("cashOutgo:")) return isCashOutgoFilterMatch(file, filter);
  if (filter.startsWith("delayStatus:")) {
    const [, daysValue = "0", milestoneKey = "all"] = filter.split(":");
    return isDelayStatusMatch(file, getDelayThresholdDays(daysValue), milestoneKey);
  }
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    const fieldValue = String(file[key as keyof FileRecord] ?? "");
    if (value === "yes") return isYes(fieldValue);
    if (value === "no") return isNo(fieldValue);
  }
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
  if (filter.startsWith("manualMilestoneCurrent:"))
    return (
      !isCancelledFile(file) &&
      file.currentMilestone === filter.slice("manualMilestoneCurrent:".length)
    );
  if (filter.startsWith("manualMilestoneCompleted:"))
    return Boolean(
      file.completedMilestones?.includes(filter.slice("manualMilestoneCompleted:".length)),
    );
  if (filter === "totalFiles") return true;
  if (filter === "demandsControlled") return hasAny(file, ["imms"]);
  if (filter === "tcecFiles") return isYes(file.tcec);
  if (filter === "nonTcecFiles") return isNo(file.tcec);
  if (filter === "highValueFiles") return isYes(file.highValue);
  if (filter === "adYes") return isYes(file.ad);
  if (filter === "rqaVetting") return isYes(file.rqa);
  if (filter === "ifaConcurrence") return isYes(file.ifa);
  if (filter === "liveBids") return isFileTenderLive(file);
  if (filter === "bidOverdue") return isBidOverdue(file);
  if (filter === "supplyOrders") return hasAny(file, ["soDate"]);
  if (filter === "liveSupplyOrders") return isLiveSupplyOrder(file);
  if (filter === "bgToBeReceived") return isBgToBeReceived(file);
  if (filter === "bgToBeReturned") return isBgToBeReturned(file);
  if (filter === "dpExtension") return isYes(file.dpExtension);
  if (filter === "dpExpired") return isDpExpired(file);
  if (filter === "deliveryOverdue") return isDeliveryOverdue(file);
  if (filter === "deliveryDueToday") return isDeliveryDueToday(file);
  if (filter === "deliveryUpcoming") return isDeliveryUpcoming(file);
  if (filter === "deliveryCompleted") return isDeliveryCompleted(file);
  if (filter === "deliveryDeliveredLate") return isDeliveryDeliveredLate(file);
  if (filter === "deliveryDue") return isDeliveryDue(file);
  if (filter === "deliveryPeriodValid") return isDeliveryPeriodValid(file);
  if (filter === "deliveryPeriodExpired") return isDeliveryPeriodExpired(file);
  if (filter === "deliveryPeriodExtended") return isDeliveryPeriodExtended(file);
  if (filter === "irPreparationPending") return isIrPreparationPending(file);
  if (filter === "irReceiptPending") return isIrReceiptPending(file);
  if (filter === "irCompleted") return isIrCompleted(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "miscLiveFiles") return !isFileClosed(file) && !isCancelledFile(file);
  if (filter === "miscFileClosed") return isFileClosed(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled")
    return fileSupplyOrders(file).some((order) => isYes(order.demandCancelled));
  if (filter === "miscSoCancelled")
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  if (filter === "miscMultipleSupplyOrders") return fileSupplyOrders(file).length > 1;
  if (filter === "scrutinyCompleted") return hasAny(file, ["scrutinyCompletionDate"]);
  if (filter === "scrutinyUnderProgress") return !hasAny(file, ["scrutinyDate"]);
  if (filter === "preTcecCompleted")
    return isYes(file.tcec) && hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "preTcecRemaining")
    return isYes(file.tcec) && !hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "highValueCompleted") return hasAny(file, ["highValueMinutesDate"]);
  if (filter === "highValueRemaining") return hasAny(file, ["highValueMeetingDate"]);
  if (filter === "adCompleted") return hasAny(file, ["adVettingDate"]);
  if (filter === "adRemaining")
    return hasAny(file, ["preTcecDate"]) && !hasAny(file, ["adVettingDate"]);
  if (filter === "rqaCompleted") return hasAny(file, ["rqaApprovalDate"]);
  if (filter === "rqaRemaining") return isYes(file.rqa) && !hasAny(file, ["rqaApprovalDate"]);
  if (filter === "ifaCompleted") return hasAny(file, ["ifaFinalDate"]);
  if (filter === "ifaRemaining") return hasAny(file, ["ifaSentDate"]);
  if (filter === "cfaCompleted") return hasAny(file, ["cfaDate"]);
  if (filter.startsWith("milestoneTotal:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(15));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file)
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    return milestone
      ? isMilestoneApplicable(file, milestone) && !isEligibleMilestone(file, milestone)
      : true;
  }
  if (filter.startsWith("milestoneActive:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(16));
    if (!milestone) return true;
    if (milestone.key === "bidding")
      return (
        isManualActiveMilestone(file, milestone) && !isFileTenderLive(file) && !isBidOverdue(file)
      );
    return isManualActiveMilestone(file, milestone);
  }
  if (filter.startsWith("milestone:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(10));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneReviewed:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isMilestoneReviewed(file, milestone) : true;
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file) && hasMilestoneDate(file, milestone.current)
      : isClearedMilestone(file, milestone);
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isEligibleMilestone(file, milestone) : true;
  }
  if (filter === "soCompleted") return hasAny(file, ["soNo"]);
  if (filter === "soRemaining") return !hasAny(file, ["soNo"]);
  return true;
}
