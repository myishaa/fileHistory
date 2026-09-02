import type { FileRecord, FirmDetail, SupplyOrderDetail } from "../types.js";
import {
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
  effectiveSupplyOrderEntries as normalizedSupplyOrderEntries,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  filePaymentOrders as normalizedFilePaymentOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getEffectiveSupplyOrderCurrentMilestone as getCanonicalSupplyOrderCurrentMilestone,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "./effective-deliveries.js";
import {
  matchesFileCategorySelection,
  normalizeFileCategories,
  type FileCategoryKey,
} from "./file-categories.js";
import {
  isBiddingApplicableForFile,
  isContractFileType,
  isDeliveryInspectionApplicableByGroup,
} from "./file-type-groups.js";
import {
  getReturnedBillCashOutgoEventDate,
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
} from "./refloat-returned-bill.js";

const biddingDelayMilestoneKey = "bidding";

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
  firmUniqueNo?: string;
  firmContactNo?: string;
  firmCity?: string;
  firmSearchScopes?: string[];
  selectedModes?: string[];
  selectedGemBiddingModes?: string[];
  selectedFirmTypes?: string[];
  selectedFileTypes?: string[];
  selectedBgCoverageTypes?: string[];
  specialFileMarker?: string;
  fileCategories?: FileCategoryKey[];
  advancePaymentFilter?: boolean;
  actualPaymentFilter?: boolean;
  stageDeliveryFilter?: boolean;
  stagePaymentFilter?: boolean;
  dpExtensionFilter?: boolean;
  ldFilter?: boolean;
  highValue?: boolean;
  gte?: boolean;
  ad?: boolean;
  rqa?: boolean;
  ifaFilter?: boolean;
  psbFilter?: boolean;
  pwbFilter?: boolean;
  psbPwbFilter?: boolean;
  bgFilter?: boolean;
  rfpVettingFilter?: boolean;
  refloat?: boolean;
  cnc?: boolean;
  tcec?: boolean;
  dpFrom?: string;
  dpTo?: string;
  demandReceiptFrom?: string;
  demandReceiptTo?: string;
  demandControlFrom?: string;
  demandControlTo?: string;
  highValueMinutesFrom?: string;
  highValueMinutesTo?: string;
  preTcecMinutesFrom?: string;
  preTcecMinutesTo?: string;
  rqaApprovalFrom?: string;
  rqaApprovalTo?: string;
  ifaFinalFrom?: string;
  ifaFinalTo?: string;
  cfaApprovalFrom?: string;
  cfaApprovalTo?: string;
  postTcecMinutesFrom?: string;
  postTcecMinutesTo?: string;
  cncDateFrom?: string;
  cncDateTo?: string;
  financialSanctionFrom?: string;
  financialSanctionTo?: string;
  soDateFrom?: string;
  soDateTo?: string;
  materialReceiptFrom?: string;
  materialReceiptTo?: string;
  paymentDateFrom?: string;
  paymentDateTo?: string;
  bgReceivedFrom?: string;
  bgReceivedTo?: string;
  bgValidityFrom?: string;
  bgValidityTo?: string;
  bgReturnFrom?: string;
  bgReturnTo?: string;
  fileClosureFrom?: string;
  fileClosureTo?: string;
  rstFilter?: boolean;
  demandCancelledFilter?: boolean;
  soCancelledFilter?: boolean;
  shortclosedSoFilter?: boolean;
  freeText?: string;
  freeDate?: string;
  dashboardFilter?: string;
  analyticsType?: "firm" | "indentor";
  analyticsNames?: string[];
  sortColumnKey?: string;
  sortDirection?: "asc" | "desc";
  divisionWiseSort?: boolean;
  requiredFilledFields?: string[];
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
  "financialSanctionDate",
  "soNo",
  "gemSoNo",
  "soDate",
  "soValueCapital",
  "soValueRevenue",
  "billAmountCapital",
  "billAmountRevenue",
  "dpDate",
  "firm",
  "firmType",
  "psbApplicable",
  "bgCoverageType",
  "psbBgNo",
  "psbBgAmount",
  "psbBgReceivedDate",
  "psbBgValidityDate",
  "psbBgReturnDate",
  "pwbBgNo",
  "pwbBgAmount",
  "pwbBgReceivedDate",
  "pwbBgValidityDate",
  "pwbBgReturnDate",
  "combinedBgNo",
  "combinedBgAmount",
  "combinedBgReceivedDate",
  "combinedBgValidityDate",
  "combinedBgReturnDate",
  "warrantyPeriodDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "ldType",
  "ldPercentage",
  "revisedDp",
  "materialReceiptDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "demandCancelled",
  "soCancelled",
  "soCancelledDate",
] satisfies SupplyOrderKey[];
const supplyOrderKeySet = new Set<string>(supplyOrderKeys);
const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Advance Payment",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Bill returned for correction",
  "Payment",
];

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
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "rst",
  "biddingStageOver",
  "cncDate",
  "cncApprovalDate",
  "demandCancelledDate",
  "noOfSo",
  "currentMilestone",
  ...supplyOrderKeys,
] satisfies Array<FileKey | SupplyOrderKey>;

const dateFileKeys = searchableFileKeys.filter(
  (key) =>
    key.toLowerCase().includes("date") ||
    key === "revisedDp" ||
    key === "dpDate" ||
    key === "psbBgReceivedDate" ||
    key === "psbBgValidityDate" ||
    key === "psbBgReturnDate" ||
    key === "pwbBgReceivedDate" ||
    key === "pwbBgValidityDate" ||
    key === "pwbBgReturnDate" ||
    key === "combinedBgReceivedDate" ||
    key === "combinedBgValidityDate" ||
    key === "combinedBgReturnDate" ||
    key === "warrantyPeriodDate",
);

const supplyOrderDateKeys = new Set<SupplyOrderKey>([
  "financialSanctionDate",
  "soDate",
  "psbBgReceivedDate",
  "psbBgValidityDate",
  "psbBgReturnDate",
  "pwbBgReceivedDate",
  "pwbBgValidityDate",
  "pwbBgReturnDate",
  "combinedBgReceivedDate",
  "combinedBgValidityDate",
  "combinedBgReturnDate",
  "warrantyPeriodDate",
  "jobCompletionDate",
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
    previous: "scrutinyCompletionDate",
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
  {
    key: "bidding",
    previous: "cfaDate",
    current: "biddingStageOver",
    applies: (file) => isBiddingApplicableForFile(file),
  },
  {
    key: "postTcec",
    previous: "biddingStageOver",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "refloatBidding",
    previous: "postTcecMinutesDate",
    current: "biddingStageOver",
    applies: (file: FileRecord) => isYes(file.refloat),
  },
  {
    key: "refloatPostTcec",
    previous: "biddingStageOver",
    reviewed: "refloatPostTcecDate",
    current: "refloatPostTcecMinutesDate",
    applies: (file: FileRecord) =>
      isYes(file.refloat) && isYes(file.tcec) && isYes(file.biddingStageOver),
  },
  {
    key: "cnc",
    previous: "postTcecMinutesDate",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "financialSanction",
    previous: "cncApprovalDate",
    current: "financialSanctionDate",
  },
  { key: "supplyOrder", previous: "postTcecMinutesDate", current: "soDate" },
  { key: "psb", previous: "financialSanctionDate", current: "psbBgReceivedDate" },
  {
    key: "pwb",
    previous: "materialReceiptDate",
    current: "pwbBgReceivedDate",
    applies: (file: FileRecord) => isYes(file.bg),
  },
  {
    key: "psbPwb",
    previous: "financialSanctionDate",
    current: "combinedBgReceivedDate",
    applies: (file: FileRecord) => isYes(file.bg),
  },
  { key: "payment", previous: "billSentForPaymentDate", current: "paymentDate" },
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
  const selectedGemBiddingModes = params.selectedGemBiddingModes ?? [];
  const selectedFirmTypes = params.selectedFirmTypes ?? [];
  const firmSearchScopes = normalizeFirmSearchScopes(params.firmSearchScopes);
  const selectedFileTypes = (params.selectedFileTypes ?? []).map(normalizeFileTypeValue);
  const selectedBgCoverageTypes = params.selectedBgCoverageTypes ?? [];
  const fileCategories = params.fileCategories;
  const analyticsNameSet = new Set((params.analyticsNames ?? []).map(normalizeAnalyticsName));
  const showDemandCancelledFiles = shouldShowDemandCancelledFiles(params);
  const requiredFilledFields = params.requiredFilledFields ?? [];

  const filtered = files.filter((file) => {
    if (!showDemandCancelledFiles && isYes(file.demandCancelled)) return false;
    if (params.yearFilter && !includesText(file.year, params.yearFilter)) return false;
    if (fileCategories && !matchesFileCategorySelection(file, fileCategories)) return false;
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
    if (params.firm && !matchesFirmScopedText(file, firmSearchScopes, "firmName", params.firm)) {
      return false;
    }
    if (
      params.firmUniqueNo &&
      !matchesFirmScopedText(file, firmSearchScopes, "firmUniqueNo", params.firmUniqueNo)
    ) {
      return false;
    }
    if (
      params.firmContactNo &&
      !matchesFirmScopedText(file, firmSearchScopes, "contactNo", params.firmContactNo)
    ) {
      return false;
    }
    if (
      params.firmCity &&
      !matchesFirmScopedText(file, firmSearchScopes, "city", params.firmCity)
    ) {
      return false;
    }
    if (
      selectedModes.length > 0 &&
      !selectedModes.includes((file.mode ?? "").trim().toUpperCase())
    ) {
      return false;
    }
    if (
      selectedGemBiddingModes.length > 0 &&
      (!isYes(file.gem) ||
        !selectedGemBiddingModes
          .map((mode) => mode.trim().toLowerCase())
          .includes((file.gemBiddingMode ?? "").trim().toLowerCase()))
    ) {
      return false;
    }
    if (
      selectedFirmTypes.length > 0 &&
      !fileSupplyOrders(file).some((order) => matchesFirmTypeFilter(order, selectedFirmTypes))
    ) {
      return false;
    }
    if (selectedFileTypes.length > 0 && !matchesSelectedFileTypes(file, selectedFileTypes)) {
      return false;
    }
    if (
      selectedBgCoverageTypes.length > 0 &&
      !fileSupplyOrders(file).some((order) =>
        selectedBgCoverageTypes.includes(String(order.bgCoverageType ?? "")),
      )
    ) {
      return false;
    }
    if (
      params.specialFileMarker?.trim() &&
      !file.markers?.some(
        (marker) =>
          (marker.text ?? "").trim().toUpperCase() ===
          params.specialFileMarker!.trim().toUpperCase(),
      )
    ) {
      return false;
    }
    if (
      params.advancePaymentFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.advancePayment))
    ) {
      return false;
    }
    if (
      params.actualPaymentFilter &&
      !fileSupplyOrders(file).some(
        (order) =>
          hasNonZeroAmount(order.actualPaymentCapital) ||
          hasNonZeroAmount(order.actualPaymentRevenue),
      )
    ) {
      return false;
    }
    if (
      params.stageDeliveryFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.stageDelivery))
    ) {
      return false;
    }
    if (
      params.stagePaymentFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.stagePayment))
    ) {
      return false;
    }
    if (
      params.dpExtensionFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.dpExtension))
    ) {
      return false;
    }
    if (params.ldFilter && !fileSupplyOrders(file).some((order) => isYes(order.ld))) {
      return false;
    }
    if (params.highValue && !isYes(file.highValue)) return false;
    if (params.gte && !isYes(file.gte)) return false;
    if (params.ad && !isYes(file.ad)) return false;
    if (params.rqa && !isYes(file.rqa)) return false;
    if (params.ifaFilter && !isYes(file.ifa)) return false;
    if (params.psbFilter && !fileSupplyOrders(file).some(isPsbOrder)) return false;
    if (params.pwbFilter && !fileSupplyOrders(file).some((order) => isPwbOrder(file, order))) {
      return false;
    }
    if (
      params.psbPwbFilter &&
      !fileSupplyOrders(file).some((order) => isCombinedPsbPwbOrder(file, order))
    ) {
      return false;
    }
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
    if (params.demandCancelledFilter && !isYes(file.demandCancelled)) {
      return false;
    }
    if (
      params.soCancelledFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.soCancelled))
    ) {
      return false;
    }
    if (
      params.shortclosedSoFilter &&
      !fileSupplyOrders(file).some((order) => isYes(order.shortclosure))
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
      (params.dpFrom || params.dpTo) &&
      !fileSupplyOrders(file).some((order) =>
        matchesDateRange(getDeliveryPeriodDate(order), params.dpFrom ?? "", params.dpTo ?? ""),
      )
    ) {
      return false;
    }
    if (
      (params.demandReceiptFrom || params.demandReceiptTo) &&
      !matchesDateRange(
        file.receivedDate ?? "",
        params.demandReceiptFrom ?? "",
        params.demandReceiptTo ?? "",
      )
    ) {
      return false;
    }
    if (!matchesFileDateRange(file.immsDate, params.demandControlFrom, params.demandControlTo)) {
      return false;
    }
    if (
      !matchesFileDateRange(
        file.highValueMinutesDate,
        params.highValueMinutesFrom,
        params.highValueMinutesTo,
      )
    ) {
      return false;
    }
    if (
      !matchesFileDateRange(
        file.preTcecMinutesDate,
        params.preTcecMinutesFrom,
        params.preTcecMinutesTo,
      )
    ) {
      return false;
    }
    if (!matchesFileDateRange(file.rqaApprovalDate, params.rqaApprovalFrom, params.rqaApprovalTo)) {
      return false;
    }
    if (!matchesFileDateRange(file.ifaFinalDate, params.ifaFinalFrom, params.ifaFinalTo)) {
      return false;
    }
    if (!matchesFileDateRange(file.cfaDate, params.cfaApprovalFrom, params.cfaApprovalTo)) {
      return false;
    }
    if (
      !matchesFileDateRange(
        file.postTcecMinutesDate,
        params.postTcecMinutesFrom,
        params.postTcecMinutesTo,
      ) &&
      !matchesFileDateRange(
        file.refloatPostTcecMinutesDate,
        params.postTcecMinutesFrom,
        params.postTcecMinutesTo,
      )
    ) {
      return false;
    }
    if (!matchesFileDateRange(file.cncDate, params.cncDateFrom, params.cncDateTo)) {
      return false;
    }
    if (
      !matchesSupplyOrderDateRange(
        file,
        "financialSanctionDate",
        params.financialSanctionFrom,
        params.financialSanctionTo,
      )
    ) {
      return false;
    }
    if (!matchesSupplyOrderDateRange(file, "soDate", params.soDateFrom, params.soDateTo)) {
      return false;
    }
    if (
      !matchesSupplyOrderDateRange(
        file,
        "materialReceiptDate",
        params.materialReceiptFrom,
        params.materialReceiptTo,
      )
    ) {
      return false;
    }
    if (
      !matchesSupplyOrderDateRange(
        file,
        "paymentDate",
        params.paymentDateFrom,
        params.paymentDateTo,
      )
    ) {
      return false;
    }
    if (
      !matchesSupplyOrderAnyDateRange(
        file,
        ["psbBgReceivedDate", "pwbBgReceivedDate", "combinedBgReceivedDate"],
        params.bgReceivedFrom,
        params.bgReceivedTo,
      )
    ) {
      return false;
    }
    if (
      !matchesSupplyOrderAnyDateRange(
        file,
        ["psbBgValidityDate", "pwbBgValidityDate", "combinedBgValidityDate"],
        params.bgValidityFrom,
        params.bgValidityTo,
      )
    ) {
      return false;
    }
    if (
      !matchesSupplyOrderAnyDateRange(
        file,
        ["psbBgReturnDate", "pwbBgReturnDate", "combinedBgReturnDate"],
        params.bgReturnFrom,
        params.bgReturnTo,
      )
    ) {
      return false;
    }
    if (
      (params.fileClosureFrom || params.fileClosureTo) &&
      !matchesDateRange(
        file.fileClosureDate ?? "",
        params.fileClosureFrom ?? "",
        params.fileClosureTo ?? "",
      )
    ) {
      return false;
    }
    if (params.freeText && !allSearchText(file).includes(params.freeText.trim().toLowerCase()))
      return false;
    if (params.freeDate && !matchesFreeDate(file, params.freeDate)) return false;
    if (!matchesRequiredFilledFields(file, requiredFilledFields)) return false;

    return true;
  });

  return sortFiles(
    filtered,
    params.sortColumnKey ?? "none",
    Boolean(params.divisionWiseSort),
    params.sortDirection ?? "asc",
  );
}

function shouldShowDemandCancelledFiles(params: FileSearchParams) {
  return params.demandCancelledFilter || params.dashboardFilter?.trim() === "miscDemandCancelled";
}

function matchesRequiredFilledFields(file: FileRecord, keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
  if (!uniqueKeys.length) return true;
  const supplyKeys = uniqueKeys.filter(
    (key) => supplyOrderKeySet.has(key) || key === "soCurrentMilestone",
  );
  const fileKeys = uniqueKeys.filter((key) => !supplyKeys.includes(key));
  if (fileKeys.some((key) => !hasRequiredFileField(file, key))) return false;
  if (!supplyKeys.length) return true;
  return fileSupplyOrders(file).some((order) =>
    supplyKeys.every((key) => hasRequiredSupplyOrderField(order, key)),
  );
}

function hasRequiredFileField(file: FileRecord, key: string) {
  if (key === "activeYears") return (file.activeYears ?? []).some(hasFilledString);
  if (key === "bqFirmNames" || key === "bqFirmUniqueNos")
    return hasRequiredFirmField(file.bqFirms, key);
  if (key === "invitedFirmNames" || key === "invitedFirmUniqueNos") {
    return hasRequiredFirmField(file.invitedFirms, key);
  }
  if (key === "bidderFirmNames" || key === "bidderFirmUniqueNos") {
    return hasRequiredFirmField(file.bidderFirms, key);
  }
  const value = (file as Record<string, unknown>)[key];
  return hasRequiredValue(value);
}

function hasRequiredFirmField(rows: FirmDetail[] | undefined, key: string) {
  const field = key.endsWith("UniqueNos") ? "firmUniqueNo" : "firmName";
  return (rows ?? []).some((row) => hasRequiredValue((row as Record<string, unknown>)[field]));
}

function hasRequiredSupplyOrderField(order: SupplyOrderDetail, key: string) {
  if (key === "soCurrentMilestone") return hasRequiredValue(order.currentMilestone);
  if (key === "stageDeliveryLabel") return (order.stageDeliveries ?? []).length > 0;
  if (key === "stageAmountCapital" || key === "stageAmountRevenue") {
    return (order.stageDeliveries ?? []).some((stage) =>
      hasRequiredValue((stage as Record<string, unknown>)[key]),
    );
  }
  if (
    key === "advanceStageAmountCapital" ||
    key === "advanceStageAmountRevenue" ||
    key === "advancePaymentDate" ||
    key === "advanceActualPaymentCapital" ||
    key === "advanceActualPaymentRevenue"
  ) {
    const fieldByKey: Record<string, string> = {
      advanceStageAmountCapital: "stageAmountCapital",
      advanceStageAmountRevenue: "stageAmountRevenue",
      advancePaymentDate: "paymentDate",
      advanceActualPaymentCapital: "actualPaymentCapital",
      advanceActualPaymentRevenue: "actualPaymentRevenue",
    };
    return hasRequiredValue(
      (order.advancePaymentDetail as Record<string, unknown> | undefined)?.[fieldByKey[key]],
    );
  }
  return hasRequiredValue((order as Record<string, unknown>)[key]);
}

function hasRequiredValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRequiredValue);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasRequiredValue);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return hasFilledString(value);
  return value !== undefined && value !== null;
}

function parseAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getInrAmount(value: string | number | undefined, file: FileRecord) {
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

type FirmSearchScope = "bq" | "invited" | "bidder" | "so";
type FirmSearchField = "firmName" | "firmUniqueNo" | "contactNo" | "city";

const defaultFirmSearchScopes: FirmSearchScope[] = ["bq", "invited", "bidder", "so"];

function normalizeFirmSearchScopes(scopes: string[] | undefined): FirmSearchScope[] {
  const allowed = new Set<FirmSearchScope>(defaultFirmSearchScopes);
  const normalized = (scopes ?? [])
    .map((scope) => scope.trim().toLowerCase())
    .filter((scope): scope is FirmSearchScope => allowed.has(scope as FirmSearchScope));
  return normalized.length ? Array.from(new Set(normalized)) : defaultFirmSearchScopes;
}

function matchesFirmDetailRows(
  rows:
    | Array<{
        firmName?: string;
        firmUniqueNo?: string;
        contactNo?: string;
        city?: string;
      }>
    | undefined,
  field: FirmSearchField,
  query: string,
) {
  return (rows ?? []).some((row) => includesText(row[field], query));
}

function matchesSupplyOrderFirmField(file: FileRecord, field: FirmSearchField, query: string) {
  const orderField =
    field === "firmName" ? "firm" : field === "contactNo" ? "firmContactNo" : field;
  return fileSupplyOrders(file).some((order) =>
    includesText(order[orderField as keyof SupplyOrderDetail] as string | undefined, query),
  );
}

function matchesFirmScopedText(
  file: FileRecord,
  scopes: FirmSearchScope[],
  field: FirmSearchField,
  query: string,
) {
  return scopes.some((scope) => {
    if (scope !== "so" && !isBiddingApplicableForFile(file)) return false;
    if (scope === "bq") return matchesFirmDetailRows(file.bqFirms, field, query);
    if (scope === "invited") return matchesFirmDetailRows(file.invitedFirms, field, query);
    if (scope === "bidder") return matchesFirmDetailRows(file.bidderFirms, field, query);
    return matchesSupplyOrderFirmField(file, field, query);
  });
}

function normalizeFileTypeValue(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function matchesSelectedFileTypes(
  file: Pick<FileRecord, "fileType" | "mode">,
  selectedFileTypes: string[],
) {
  const fileType = normalizeFileTypeValue(file.fileType);
  if (selectedFileTypes.includes(fileType)) return true;
  return (
    selectedFileTypes.includes("goods & services") &&
    !["amc", "mpc", "cars", "o&m"].includes(fileType)
  );
}

function matchesFirmTypeFilter(order: SupplyOrderDetail, selectedFirmTypes: string[]) {
  const firmType = (order.firmType ?? "").trim().toUpperCase();
  const firmTypeOther = (order.firmTypeOther ?? "").trim().toUpperCase();
  const normalizedFirmTypes = selectedFirmTypes.map((firmType) => firmType.trim().toUpperCase());
  return normalizedFirmTypes.includes(firmType) || normalizedFirmTypes.includes(firmTypeOther);
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function getTcecCommittee(file: FileRecord, stage: "pre" | "post") {
  return stage === "pre"
    ? file.preTcecCommitteeNo?.trim()
    : (isYes(file.refloat)
        ? file.refloatPostTcecCommitteeNo
        : file.postTcecCommitteeNumber
      )?.trim();
}

function getTcecMeetingDate(file: FileRecord, stage: "pre" | "post") {
  return stage === "pre"
    ? file.preTcecDate
    : isYes(file.refloat)
      ? file.refloatPostTcecDate
      : file.postTcecDate;
}

function getTcecMinutesDate(file: FileRecord, stage: "pre" | "post") {
  return stage === "pre"
    ? file.preTcecMinutesDate
    : isYes(file.refloat)
      ? file.refloatPostTcecMinutesDate
      : file.postTcecMinutesDate;
}

function isPsbOrder(order: SupplyOrderDetail) {
  return (
    isYes(order.psbApplicable) &&
    (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately")
  );
}

function isPwbOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isYes(file.bg) &&
    (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
  );
}

function isCombinedPsbPwbOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.bg) && order.bgCoverageType === "PSB+PWB";
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

function isDateBefore(date: string | undefined, reference: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const referenceTime = parseLocalDateTime(reference ?? "");
  return dateTime !== undefined && referenceTime !== undefined && dateTime < referenceTime;
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
  return normalizedFileSupplyOrders(file);
}

function filePaymentOrders(file: FileRecord) {
  return normalizedFilePaymentOrders(file);
}

function isCancelledFile(file: FileRecord) {
  if (isYes(file.demandCancelled)) return true;
  const orders = rawSupplyOrders(file);
  if (orders.length === 0) return false;
  return orders.every((order) => isYes(order.soCancelled));
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(order.soCancelled);
}

function isPaymentOrderActive(file: FileRecord, order: SupplyOrderDetail) {
  return !isYes(file.demandCancelled) && !isYes(order.soCancelled);
}

function isOrderActiveForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order)
    : !isSupplyOrderCancelled(file, order);
}

function isOrderActiveForCurrentMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order)
    : !isSupplyOrderCancelled(file, order) && !isYes(order.shortclosure);
}

function isPaymentMilestone(normalizedMilestone: string) {
  return [
    "advancepayment",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
  ].includes(normalizedMilestone);
}

function hasSupplyOrderValue(file: FileRecord, order: SupplyOrderDetail) {
  const capitalSelected = hasNonZeroAmount(file.valueCapital);
  const revenueSelected = hasNonZeroAmount(file.valueRevenue);
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

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return hasFilledString(order.financialSanctionDate);
}

function isSupplyOrderPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    isFinancialSanctionCompletedOrder(order) &&
    !isSupplyOrderTabComplete(file, order)
  );
}

function isDeliveryPeriodCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    hasSupplyOrderDate(order) &&
    !isYes(order.stageDelivery) &&
    !hasFilledString(getDeliveryDueDate(order))
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
  return String(rawSupplyOrders(file).filter(hasSupplyOrderDate).length);
}

function rawSupplyOrders(file: FileRecord) {
  return normalizedRawSupplyOrders(file);
}

function expectedSupplyOrders(file: FileRecord) {
  return normalizedExpectedSupplyOrders(file);
}

function hasFilledObjectValue(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, item]) => {
    if (Array.isArray(item)) {
      return item.some((row) => hasFilledObjectValue(row as Record<string, unknown>));
    }
    if (item && typeof item === "object") {
      return hasFilledObjectValue(item as Record<string, unknown>);
    }
    const text = String(item ?? "").trim();
    if (!text) return false;
    return !isDefaultNoField(key, text);
  });
}

function isDefaultNoField(key: string, value: string) {
  return (
    value.toLowerCase() === "no" &&
    [
      "advancePayment",
      "demandCancelled",
      "dpExtension",
      "ld",
      "soCancelled",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
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
    hasAny(file, [
      "preTcecDate",
      "preTcecMinutesDate",
      "postTcecDate",
      "postTcecMinutesDate",
      "refloatPostTcecDate",
      "refloatPostTcecMinutesDate",
    ])
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

function matchesFileDateRange(date: string | undefined, from?: string, to?: string) {
  return matchesDateRange(date ?? "", from ?? "", to ?? "");
}

function matchesSupplyOrderDateRange(
  file: FileRecord,
  key: SupplyOrderKey,
  from: string | undefined,
  to: string | undefined,
) {
  if (!from && !to) return true;
  return fileSupplyOrders(file).some((order) =>
    matchesDateRange(String(order[key] ?? ""), from ?? "", to ?? ""),
  );
}

function matchesSupplyOrderAnyDateRange(
  file: FileRecord,
  keys: SupplyOrderKey[],
  from: string | undefined,
  to: string | undefined,
) {
  if (!from && !to) return true;
  return fileSupplyOrders(file).some((order) =>
    keys.some((key) => matchesDateRange(String(order[key] ?? ""), from ?? "", to ?? "")),
  );
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
  const markerText = file.markers?.map((marker) => marker.text).join(" ") ?? "";
  const firmText = [getFirmCount(file.invitedFirms), getFirmCount(file.bidderFirms)].join(" ");
  return `${directText} ${supplyOrderText} ${remarkText} ${markerText} ${firmText}`.toLowerCase();
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
  return isBiddingApplicableForFile(file) && isYes(file.tenderLive);
}

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)
    ? file.refloatBidOpeningDate
    : file.bidOpeningDate;
}

function isBidOverdue(file: FileRecord) {
  return (
    isBiddingApplicableForFile(file) &&
    isNo(file.bidOpened) &&
    isDateBeforeToday(getEffectiveBidOpeningDate(file))
  );
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgToBeReceived(file: FileRecord, category = "bankguarantee") {
  return expectedSupplyOrders(file).some(
    (order) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgCurrentOrder(file, order, category) &&
      !isBgReceivedOrder(order, category) &&
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure),
  );
}

function isPsbApplicableFile(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      isYes(order.psbApplicable) &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately"),
  );
}

function isBgCurrentOrder(file: FileRecord, order: SupplyOrderDetail, category = "bankguarantee") {
  const normalized = normalizeMilestoneName(category);
  if (
    normalized === "psbpwb" &&
    isFinancialSanctionCompletedOrder(order) &&
    !hasFilledString(order.combinedBgReceivedDate)
  ) {
    return true;
  }
  if (
    normalized === "pwb" &&
    hasFilledString(order.materialReceiptDate) &&
    !hasFilledString(order.pwbBgReceivedDate)
  ) {
    return true;
  }
  if (
    normalized === "psb" &&
    isFinancialSanctionCompletedOrder(order) &&
    !hasFilledString(order.psbBgReceivedDate)
  ) {
    return true;
  }
  return normalizeMilestoneName(order.currentMilestone) === normalizeMilestoneName(category);
}

function isBgToBeReturned(file: FileRecord, category = "bankguarantee") {
  return rawSupplyOrders(file).some((order) => isBgReturnDueOrder(file, order, category));
}

function isBgExpired(file: FileRecord, category = "bankguarantee") {
  return rawSupplyOrders(file).some((order) => isBgExpiredOrder(file, order, category));
}

function isBgReturned(file: FileRecord, category = "bankguarantee") {
  return rawSupplyOrders(file).some(
    (order) =>
      isBgCategoryApplicable(file, order, category) &&
      hasFilledString(getBgReturnDate(order, category)),
  );
}

function isBgReturnDueOrder(
  file: FileRecord,
  order: SupplyOrderDetail,
  category = "bankguarantee",
) {
  if (
    !isBgCategoryApplicable(file, order, category) ||
    !isBgReceivedOrder(order, category) ||
    hasFilledString(getBgReturnDate(order, category))
  ) {
    return false;
  }
  if (isYes(order.soCancelled) || isYes(order.shortclosure)) return true;
  const normalized = normalizeMilestoneName(category);
  return (
    !isSupplyOrderCancelled(file, order) &&
    (normalized === "psb"
      ? isPsbReturnPurposeComplete(file, order)
      : isWarrantyBgReturnPurposeComplete(file, order, normalized))
  );
}

function isWarrantyBgReturnPurposeComplete(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
) {
  if (category !== "pwb" && category !== "psbpwb") return false;
  if (!isBgCategoryApplicable(file, order, category)) return false;
  if (!hasFilledString(order.warrantyPeriodDate)) return false;
  return isDateBeforeToday(addDays(order.warrantyPeriodDate, 60));
}

function isPsbReturnPurposeComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!isDeliveryInspectionApplicable(file)) {
    if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
      return order.stageDeliveries.every(isJobCompletionDone);
    }
    return isJobCompletionDone(order);
  }
  if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    return order.stageDeliveries.every((stage) => hasPsbReturnCompletion(file, stage));
  }
  return hasPsbReturnCompletion(file, order);
}

function hasPaymentDueCompletion(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPaymentWorkflowStartDate(file, order));
}

function hasPsbReturnCompletion(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasFilledString(order.irReceiptDate);
  return isJobCompletionDone(order);
}

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail, category = "bankguarantee") {
  const validityDate = getBgValidityDate(order, category);
  const normalized = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !isSupplyOrderCancelled(file, order) &&
    (normalized === "psb"
      ? !isPsbReturnPurposeComplete(file, order)
      : !hasFilledString(order.paymentDate)) &&
    hasFilledString(validityDate) &&
    isDateBeforeToday(validityDate)
  );
}

function isDpExpired(file: FileRecord) {
  return fileSupplyOrders(file).some((order) => isDateBeforeToday(getDeliveryPeriodDate(order)));
}

function isDeliveryOverdue(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(file, order),
    )
  );
}

function isDeliveryDueToday(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isDueTodayDeliveryOrder(file, order),
    )
  );
}

function isDeliveryUpcoming(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isUpcomingDeliveryOrder(file, order),
    )
  );
}

function isDeliveryDeliveredLate(file: FileRecord) {
  return (
    isDeliveryActive(file) &&
    fileSupplyOrders(file).some((order) => isLateDeliveredOrder(file, order))
  );
}

function isDeliveryCompleted(file: FileRecord) {
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isCompletedDeliveryOrder(file, order),
    )
  );
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
    )
  );
}

function isDeliveryActive(file: FileRecord) {
  return isDeliveryInspectionApplicable(file) && isSupplyOrderPlaced(file);
}

function isPhysicalDeliveryWorkflow(file: FileRecord) {
  return isDeliveryInspectionApplicable(file);
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isPhysicalDeliveryWorkflow(file);
}

function isGoodsServicesIrNo(file: FileRecord) {
  return !isContractFileType(file) && isNo(file.ir);
}

function isCompletedDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    hasFilledString(order.materialReceiptDate)
  );
}

function isJobCompletionDone(order: SupplyOrderDetail) {
  return hasFilledString(order.jobCompletionDate);
}

function isBillPreparationCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (isYes(order.shortclosure)) return false;
  if (hasFilledString(order.billPreparationDate)) return false;
  if (isDeliveryInspectionApplicable(file)) {
    return isYes(file.ir) && hasFilledString(order.irReceiptDate);
  }
  return hasFilledString(getNonInspectionPaymentDueDate(file, order));
}

function isJobCompletionCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (
    !hasSupplyOrderDate(order) ||
    !isJobCompletionWorkflow(file) ||
    isJobCompletionDone(order) ||
    isYes(order.shortclosure)
  ) {
    return false;
  }
  return isDateBeforeToday(getDeliveryPeriodDate(order));
}

function isDueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    !isCompletedDeliveryOrder(file, order) &&
    !isYes(order.soCancelled) &&
    !isYes(order.shortclosure)
  );
}

function isJobCompletionLive(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    normalizedSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) && isJobCompletionCurrentOrder(entryFile, order),
    )
  );
}

function isJobCompletionCompleted(file: FileRecord) {
  if (isCancelledFile(file) || !isJobCompletionWorkflow(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasSupplyOrderDate(order) &&
        isJobCompletionDone(order),
    )
  );
}

function isJobCompletionPeriodOver(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasSupplyOrderDate(order) &&
        isJobCompletionWorkflow(file) &&
        !isJobCompletionDone(order) &&
        isDateBeforeToday(getDeliveryPeriodDate(order)),
    )
  );
}

function isPendingDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  const dueDate = getDeliveryDueDate(order);
  return isDueDeliveryOrder(file, order) && hasFilledString(dueDate) && !isDateBeforeToday(dueDate);
}

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function isCurrentDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryDueDate = getDeliveryDueDate(order);
  return (
    hasFilledString(deliveryDueDate) &&
    !isDateAfterToday(order.deliveryPeriodStartDate || order.soDate) &&
    !isDateBeforeToday(deliveryDueDate)
  );
}

function isOverdueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isDateBeforeToday(getDeliveryDueDate(order));
}

function isDueTodayDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isDateToday(getDeliveryDueDate(order));
}

function isUpcomingDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isDateAfterToday(getDeliveryDueDate(order));
}

function isLateDeliveredOrder(file: FileRecord, order: SupplyOrderDetail) {
  const dueTime = parseLocalDateTime(getDeliveryDueDate(order) ?? "");
  const receiptTime = parseLocalDateTime(order.materialReceiptDate ?? "");
  return (
    isCompletedDeliveryOrder(file, order) &&
    dueTime !== undefined &&
    receiptTime !== undefined &&
    receiptTime > dueTime
  );
}

function isDeliveryPeriodValid(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    normalizedSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) && isValidDeliveryPeriodEntry(entryFile, order),
    )
  );
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isDeliveryPeriodActive(file) &&
    normalizedSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) && isExpiredDeliveryPeriodEntry(entryFile, order),
    )
  );
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    normalizedSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) &&
        isExtendedDeliveryPeriodEntry(entryFile, order),
    )
  );
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

function isBgReceived(file: FileRecord, category = "psb") {
  return expectedSupplyOrders(file).some(
    (order) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgReceivedOrder(order, category) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgReceivedOrder(order: SupplyOrderDetail, category = "bankguarantee") {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function isPaymentDue(file: FileRecord) {
  return isPaymentPending(file);
}

function isPaymentPending(file: FileRecord) {
  return finalPaymentOrders(file).some(
    (order) =>
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate) &&
      isPaymentOrderActive(file, order),
  );
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    hasBillReturnHistory(order) ||
    isPaymentDueByDeliveryOrPeriod(file, order)
  );
}

function isPaymentDueByDeliveryOrPeriod(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPaymentWorkflowStartDate(file, order));
}

function isPaymentCompleted(file: FileRecord) {
  return finalPaymentOrders(file).some(
    (order) => hasFilledString(order.paymentDate) && isPaymentOrderActive(file, order),
  );
}

function finalPaymentOrders(file: FileRecord) {
  return filePaymentOrders(file).filter((order) => order.stageDeliveryLabel !== "Advance Payment");
}

function matchesFinanceCarryForwardFilter(file: FileRecord, filter: string) {
  const [, mode = "", rawSelectedYear = "", rawSourceYear = ""] = filter.split(":");
  const selectedYear = decodeStatusFilterPart(rawSelectedYear);
  const sourceYear = decodeStatusFilterPart(rawSourceYear);
  const range = getFinancialYearDateRange(selectedYear);
  if (!selectedYear || !sourceYear || !range) return false;
  return finalPaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    const orderYear = getFinancialYearForDate(order.soDate);
    if (!orderYear || orderYear !== sourceYear) return false;
    const paymentDate = order.paymentDate;
    const paidInSelectedYear = isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd =
      !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
    if (mode === "carryForward") return orderYear === selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "clearedCarryForward") return orderYear < selectedYear && paidInSelectedYear;
    if (mode === "previousCarryForward") return orderYear < selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "futureClearedCarryForward") {
      return (
        orderYear === selectedYear &&
        hasFilledString(paymentDate) &&
        isDateAfter(paymentDate, range.end) &&
        getFinancialYearForDate(paymentDate) === sourceYear
      );
    }
    return false;
  });
}

function hasAdvancePaymentPaid(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPaid(order) && isPaymentOrderActive(entryFile, order),
  );
}

function hasAdvancePaymentPending(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
  );
}

function isIrPreparationPending(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasSupplyOrderDate(order) &&
        hasFilledString(order.materialReceiptDate) &&
        !hasFilledString(order.irPreparationDate) &&
        !isSupplyOrderCancelled(file, order) &&
        !isYes(order.shortclosure),
    )
  );
}

function isIrReceiptPending(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasFilledString(order.irPreparationDate) &&
        !hasFilledString(order.irReceiptDate) &&
        !isSupplyOrderCancelled(file, order) &&
        !isYes(order.shortclosure),
    )
  );
}

function isIrCompleted(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) => hasFilledString(order.irReceiptDate) && !isSupplyOrderCancelled(file, order),
    )
  );
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
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
  const biddingMatch =
    (selectedMilestoneKey === "all" || selectedMilestoneKey === biddingDelayMilestoneKey) &&
    isBiddingDelayMatch(file, thresholdDays);
  const milestone = milestoneDefinitions
    .filter((item) => !isSupplyOrderDrivenDelayMilestoneKey(item.key))
    .filter((item) => item.key !== biddingDelayMilestoneKey)
    .find((item) => isManualActiveMilestone(file, item));
  const mainMatch = (() => {
    if (!milestone) return false;
    if (selectedMilestoneKey !== "all" && milestone.key !== selectedMilestoneKey) return false;
    if (isMilestoneComplete(file, milestone)) return false;

    const stageStartDate = getMilestoneStageStartDate(file, milestone);
    const daysInStage = getDaysSinceDate(stageStartDate);
    return daysInStage !== undefined && daysInStage > thresholdDays;
  })();
  return (
    biddingMatch || mainMatch || isOrderDelayStatusMatch(file, thresholdDays, selectedMilestoneKey)
  );
}

function isBiddingDelayMatch(file: FileRecord, thresholdDays: number, breakupKey?: string) {
  const status = getBiddingDelayStatus(file);
  if (!status) return false;
  if (breakupKey && status.key !== breakupKey) return false;
  const daysInStage = getDaysSinceDate(status.stageStartDate);
  return daysInStage !== undefined && daysInStage > thresholdDays;
}

function getBiddingDelayStatus(file: FileRecord) {
  if (isCancelledFile(file) || isFileClosed(file)) return undefined;
  if (!isBiddingApplicableForFile(file)) return undefined;
  if (!hasFilledString(file.cfaDate) || isYes(file.biddingStageOver)) return undefined;
  const bidDate = isYes(file.refloat) ? file.refloatBiddingDate : file.bidDate;
  const bidOpeningDate = isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
  const prerequisiteDoneDate =
    latestDateValue([file.cfaDate, file.gemUndertakingDate, file.rfpVettingApprovalDate]) ??
    file.cfaDate;
  if (isYes(file.gem) && !hasFilledString(file.gemUndertakingDate)) {
    return { key: "gemUndertakingPending", stageStartDate: file.cfaDate };
  }
  const rfpStartDate = isYes(file.gem) ? file.gemUndertakingDate || file.cfaDate : file.cfaDate;
  if (isYes(file.rfpVetting) && !hasFilledString(file.rfpVettingInitiationDate)) {
    return { key: "rfpVettingInitiationPending", stageStartDate: rfpStartDate };
  }
  if (
    isYes(file.rfpVetting) &&
    hasFilledString(file.rfpVettingInitiationDate) &&
    !hasFilledString(file.rfpVettingApprovalDate)
  ) {
    return { key: "rfpVettingApprovalPending", stageStartDate: file.rfpVettingInitiationDate };
  }
  if (!isYes(file.tenderLive) && !hasFilledString(bidDate)) {
    return { key: "tenderLivePending", stageStartDate: prerequisiteDoneDate };
  }
  if (
    hasFilledString(bidOpeningDate) &&
    isDateBeforeToday(bidOpeningDate) &&
    !isYes(file.bidOpened)
  ) {
    return { key: "bidOpeningOverdue", stageStartDate: bidOpeningDate };
  }
  if (isYes(file.bidOpened)) {
    return {
      key: "biddingStageCompletionPending",
      stageStartDate: bidOpeningDate || bidDate || prerequisiteDoneDate,
    };
  }
  return undefined;
}

function isSupplyOrderDrivenDelayMilestoneKey(key: string) {
  return (
    key === "financialSanction" ||
    key === "supplyOrder" ||
    key === "psb" ||
    key === "pwb" ||
    key === "psbPwb" ||
    key === "payment"
  );
}

function isOrderDelayStatusMatch(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  return getOrderDelayMilestones()
    .filter((milestone) => selectedMilestoneKey === "all" || milestone.key === selectedMilestoneKey)
    .some((milestone) =>
      supplyOrderMilestoneRows(file, milestone.current).some((order) => {
        if (isSupplyOrderCancelled(file, order)) return false;
        if ("applies" in milestone && milestone.applies && !milestone.applies(file)) return false;
        if (getOrderDelayCurrentMilestone(file, order, milestone.current) !== milestone.current)
          return false;
        if (hasDate(milestone.complete(order))) return false;
        const daysInStage = getDaysSinceDate(milestone.start(file, order));
        return daysInStage !== undefined && daysInStage > thresholdDays;
      }),
    );
}

function getOrderDelayMilestones() {
  return [
    {
      key: "financialSanction",
      current: "financialsanction",
      start: (file: FileRecord) => getMainTimelineLastFilledDateValue(file),
      complete: (order: SupplyOrderDetail) => order.financialSanctionDate,
    },
    {
      key: "supplyOrder",
      current: "supplyorder",
      start: (file: FileRecord, order: SupplyOrderDetail) =>
        order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
      complete: (order: SupplyOrderDetail) => order.soDate,
    },
    {
      key: "advancePayment",
      current: "advancepayment",
      start: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
      complete: (order: SupplyOrderDetail) => order.advancePaymentDetail?.paymentDate,
    },
    {
      key: "delivery",
      current: "delivery",
      start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
      complete: (order: SupplyOrderDetail) => order.materialReceiptDate,
      applies: (file: FileRecord) => isDeliveryInspectionApplicable(file),
    },
    {
      key: "jobCompletion",
      current: "jobcompletion",
      start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
      complete: (order: SupplyOrderDetail) =>
        isJobCompletionDone(order) ? "9999-12-31" : undefined,
      applies: (file: FileRecord) => isJobCompletionWorkflow(file),
    },
    {
      key: "irPreparation",
      current: "irpreparation",
      start: (_file: FileRecord, order: SupplyOrderDetail) => order.materialReceiptDate,
      complete: (order: SupplyOrderDetail) => order.irPreparationDate,
    },
    {
      key: "irReceipt",
      current: "irreceipt",
      start: (_file: FileRecord, order: SupplyOrderDetail) => order.irPreparationDate,
      complete: (order: SupplyOrderDetail) => order.irReceiptDate,
    },
    {
      key: "billPreparation",
      current: "billpreparation",
      start: (_file: FileRecord, order: SupplyOrderDetail) =>
        isDeliveryInspectionApplicable(_file) ? order.irReceiptDate : order.jobCompletionDate,
      complete: (order: SupplyOrderDetail) => order.billPreparationDate,
    },
    {
      key: "billSentForPayment",
      current: "billsentforpayment",
      start: (_file: FileRecord, order: SupplyOrderDetail) => order.billPreparationDate,
      complete: (order: SupplyOrderDetail) =>
        hasOpenBillReturn(order) ? "" : order.billSentForPaymentDate,
    },
    {
      key: "payment",
      current: "payment",
      start: (file: FileRecord, order: SupplyOrderDetail) =>
        isDeliveryInspectionApplicable(file)
          ? order.materialReceiptDate || order.billSentForPaymentDate
          : getPaymentWorkflowStartDate(file, order) || order.billSentForPaymentDate,
      complete: (order: SupplyOrderDetail) => order.paymentDate,
    },
  ];
}

function getSupplyOrderStageStartDate(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find((item) => item.key === "supplyOrder");
  return supplyOrderMilestone ? getMilestoneStageStartDate(file, supplyOrderMilestone) : undefined;
}

function getLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
    ...fileSupplyOrders(file).flatMap((order) => [
      order.financialSanctionDate,
      order.soDate,
      order.dpDate,
      order.psbBgReceivedDate,
      order.psbBgValidityDate,
      order.psbBgReturnDate,
      order.pwbBgReceivedDate,
      order.pwbBgValidityDate,
      order.pwbBgReturnDate,
      order.combinedBgReceivedDate,
      order.combinedBgValidityDate,
      order.combinedBgReturnDate,
      order.revisedDp,
      order.materialReceiptDate,
      order.irPreparationDate,
      order.irReceiptDate,
      order.billPreparationDate,
      order.billSentForPaymentDate,
      order.paymentDate,
      order.soCancelledDate,
    ]),
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getOrderTimelineLastFilledDateValue(file: FileRecord, order: SupplyOrderDetail) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
    order.financialSanctionDate,
    order.soDate,
    order.dpDate,
    order.psbBgReceivedDate,
    order.psbBgValidityDate,
    order.psbBgReturnDate,
    order.pwbBgReceivedDate,
    order.pwbBgValidityDate,
    order.pwbBgReturnDate,
    order.combinedBgReceivedDate,
    order.combinedBgValidityDate,
    order.combinedBgReturnDate,
    order.revisedDp,
    order.materialReceiptDate,
    order.irPreparationDate,
    order.irReceiptDate,
    order.billPreparationDate,
    order.billSentForPaymentDate,
    order.paymentDate,
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getMilestoneStageStartDate(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  void milestone;
  return getLastFilledDateValue(file);
}

function getPreviousApplicableMilestone(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (!isBlockingPreviousMilestone(item)) continue;
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

function latestDateValue(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => hasFilledString(value))
    .sort((a, b) => (parseLocalDateTime(b) ?? 0) - (parseLocalDateTime(a) ?? 0))[0];
}

function getMainTimelineLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
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

function getFinancialYearDateRange(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function getFinancialYearForDate(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const parsed = new Date(time);
  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function isDateWithinRange(date: string | undefined, range: { start: string; end: string }) {
  return hasFilledString(date) && date! >= range.start && date! <= range.end;
}

function isDateAfter(date: string | undefined, reference: string) {
  return hasFilledString(date) && date! > reference;
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
    "expectedReceiptThrough",
    "expectedReceiptPendingBill",
    "billPreparation",
    "billSent",
    "actual",
    "actualThrough",
    "returnedBills",
    "pendingReturnedBills",
    "returnedBillsResubmitted",
    "returnedBillsPaid",
  ];
  if (
    !validModes.includes(mode) ||
    (monthKey !== "all" && !/^\d{4}-\d{2}$/.test(monthKey)) ||
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
  return hasDate(date) && (monthKey === "all" || date?.slice(0, 7) === monthKey);
}

function dateInRange(
  date: string | undefined,
  fromDate: string | undefined,
  toDate: string | undefined,
) {
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
  const orders =
    parsed.mode === "billPreparation" ||
    parsed.mode === "billSent" ||
    parsed.mode === "actual" ||
    parsed.mode === "actualThrough" ||
    parsed.mode === "returnedBills" ||
    parsed.mode === "pendingReturnedBills" ||
    parsed.mode === "returnedBillsResubmitted" ||
    parsed.mode === "returnedBillsPaid"
      ? filePaymentOrders(file)
      : fileSupplyOrders(file);
  return orders.some((order) => {
    const rangeMatches = (date: string | undefined) =>
      monthMatches(date, parsed.monthKey) && dateInRange(date, parsed.fromDate, parsed.toDate);
    const toDate = parsed.toDate ?? parsed.asOfDate;
    const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
    if (parsed.mode === "expectedDp") {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      const cashOutgoDate = addDays(deliveryPeriodDate, parsed.offsetDays + 1);
      return (
        hasFilledString(deliveryPeriodDate) &&
        !isSupplyOrderCancelled(file, order) &&
        isExpectedDpCashOutgoPending(file, order, parsed.asOfDate) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "expectedReceipt") {
      const reportDate = getReceiptPendingBillReportDate(file, order);
      const cashOutgoDate = addDays(reportDate, parsed.offsetDays);
      return (
        hasFilledString(reportDate) &&
        (parsed.asOfDate ? isOnOrBefore(reportDate, parsed.asOfDate) : true) &&
        (parsed.asOfDate
          ? isMissingOrAfter(order.paymentDate, parsed.asOfDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "expectedReceiptThrough") {
      const throughDate =
        parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey);
      const reportDate = getReceiptPendingBillReportDate(file, order);
      const cashOutgoDate = addDays(reportDate, parsed.offsetDays);
      return (
        hasFilledString(reportDate) &&
        (parsed.asOfDate ? isOnOrBefore(reportDate, parsed.asOfDate) : true) &&
        (parsed.asOfDate
          ? isMissingOrAfter(order.paymentDate, parsed.asOfDate)
          : !hasFilledString(order.paymentDate)) &&
        isOnOrBefore(cashOutgoDate, throughDate) &&
        dateInRange(cashOutgoDate, parsed.fromDate, throughDate)
      );
    }
    if (parsed.mode === "expectedReceiptPendingBill") {
      if (isSupplyOrderCancelled(file, order)) return false;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      const cashOutgoDate = addDays(reportDate, parsed.offsetDays);
      return (
        hasFilledString(reportDate) &&
        isOnOrBefore(reportDate, toDate) &&
        (toDate
          ? isMissingOrAfter(order.billPreparationDate, toDate)
          : !hasFilledString(order.billPreparationDate)) &&
        (toDate
          ? isMissingOrAfter(order.paymentDate, toDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(cashOutgoDate)
      );
    }
    if (parsed.mode === "billPreparation") {
      if (isSupplyOrderCancelled(file, order)) return false;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      return (
        (isAdvancePayment || hasFilledString(reportDate)) &&
        hasFilledString(order.billPreparationDate) &&
        (isAdvancePayment || isOnOrBefore(reportDate, toDate)) &&
        isOnOrBefore(order.billPreparationDate, toDate) &&
        (toDate
          ? isMissingOrAfter(order.billSentForPaymentDate, toDate)
          : !hasFilledString(order.billSentForPaymentDate)) &&
        (toDate
          ? isMissingOrAfter(order.paymentDate, toDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(order.billPreparationDate)
      );
    }
    if (parsed.mode === "billSent") {
      if (isSupplyOrderCancelled(file, order)) return false;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      return (
        (isAdvancePayment || hasFilledString(reportDate)) &&
        hasFilledString(order.billPreparationDate) &&
        hasFilledString(order.billSentForPaymentDate) &&
        (isAdvancePayment || isOnOrBefore(reportDate, toDate)) &&
        isOnOrBefore(order.billPreparationDate, toDate) &&
        isOnOrBefore(order.billSentForPaymentDate, toDate) &&
        (toDate
          ? isMissingOrAfter(order.paymentDate, toDate)
          : !hasFilledString(order.paymentDate)) &&
        rangeMatches(order.billSentForPaymentDate)
      );
    }
    if (parsed.mode === "actualThrough") {
      const throughDate =
        parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey);
      return (
        hasFilledString(order.paymentDate) &&
        !(isYes(order.soCancelled) && hasFilledString(order.soCancelledDate)) &&
        isOnOrBefore(order.paymentDate, throughDate) &&
        dateInRange(order.paymentDate, parsed.fromDate, throughDate)
      );
    }
    if (
      parsed.mode === "returnedBills" ||
      parsed.mode === "pendingReturnedBills" ||
      parsed.mode === "returnedBillsResubmitted" ||
      parsed.mode === "returnedBillsPaid"
    ) {
      if (isSupplyOrderCancelled(file, order)) return false;
      const eventDate = getReturnedBillCashOutgoEventDate(order, parsed.mode);
      return rangeMatches(eventDate);
    }
    return (
      hasFilledString(order.paymentDate) &&
      !(isYes(order.soCancelled) && hasFilledString(order.soCancelledDate)) &&
      rangeMatches(order.paymentDate)
    );
  });
}

function isCashOutgoAnyFilterMatch(file: FileRecord, filter: string) {
  const [, rawModes, rawMonthKey, rawOffsetDays, rawFromDate, rawToDate, rawAsOfDate] =
    filter.split(":");
  const modes = (rawModes ?? "")
    .split(",")
    .map((mode) => decodeURIComponent(mode).trim())
    .filter(Boolean);
  if (!modes.length) return false;
  return modes.some((mode) =>
    isCashOutgoFilterMatch(
      file,
      [
        "cashOutgo",
        mode,
        rawMonthKey ?? "",
        rawOffsetDays ?? "0",
        rawFromDate ?? "",
        rawToDate ?? "",
        rawAsOfDate ?? "",
      ].join(":"),
    ),
  );
}

function getMonthEndDateFromMonthKey(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number.parseInt(yearText ?? "", 10);
  const month = Number.parseInt(monthText ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return `${monthKey}-31`;
  }
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function getReceiptPendingBillReportDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isGoodsServicesIrNo(file)) return order.jobCompletionDate;
  return addDays(getDeliveryPeriodDate(order), 1);
}

function isExpectedDpCashOutgoPending(
  file: FileRecord,
  order: SupplyOrderDetail,
  asOfDate?: string,
) {
  if (isDeliveryInspectionApplicable(file)) {
    return asOfDate
      ? isMissingOrAfter(order.materialReceiptDate, asOfDate) &&
          isMissingOrAfter(order.paymentDate, asOfDate)
      : !hasFilledString(order.materialReceiptDate) && !hasFilledString(order.paymentDate);
  }

  return asOfDate
    ? isMissingOrAfter(order.billPreparationDate, asOfDate) &&
        isMissingOrAfter(order.billSentForPaymentDate, asOfDate) &&
        isMissingOrAfter(order.paymentDate, asOfDate)
    : !hasFilledString(order.billPreparationDate) &&
        !hasFilledString(order.billSentForPaymentDate) &&
        !hasFilledString(order.paymentDate);
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

function isAtPreviousStageFile(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (!isEligibleMilestone(file, milestone)) return false;
  if (isMilestoneComplete(file, milestone)) return false;
  if (isManualActiveMilestone(file, milestone)) return false;
  if (isMilestoneReviewed(file, milestone)) return false;
  if (milestone.key === "bidding" && (isFileTenderLive(file) || isBidOverdue(file))) return false;
  const milestoneName = getMilestoneLabelAliases(milestone.key)[0] ?? milestone.key;
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    const normalized = normalizeMilestoneName(milestoneName);
    if (matchesCurrentSupplyOrderDrivenMilestone(file, normalized)) return false;
    if (matchesCompletedSupplyOrderDrivenMilestone(file, normalized)) return false;
  }
  return true;
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
  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (!isBlockingPreviousMilestone(item)) continue;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
}

function isBlockingPreviousMilestone(
  milestone: Pick<(typeof milestoneDefinitions)[number], "key">,
) {
  return milestone.key !== "highValue";
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") return isYes(file.biddingStageOver);
  if (milestone.key === "refloatBidding") {
    return isYes(file.refloat) && isYes(file.biddingStageOver);
  }
  if (milestone.key === "financialSanction")
    return matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction");
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
    financialSanction: "Financial Sanction",
    supplyOrder: "Supply Order",
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

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((milestone) => milestone.trim()).filter(Boolean)));
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
    return fileSupplyOrders(file).some((order) => {
      const value = order[key as SupplyOrderKey];
      return typeof value === "string" && hasFilledString(value);
    });
  }
  const value = file[key as FileKey];
  return typeof value === "string" && hasFilledString(value);
}

function matchesStatus4DashboardFilter(file: FileRecord, filter: string) {
  const [
    ,
    rawMilestone = "",
    rawMetric = "current",
    rawFiscalYear = "",
    rawMonthKey = "all",
    rawMin = "",
    rawMax = "",
  ] = filter.split(":");
  const milestone = decodeStatusFilterPart(rawMilestone);
  const metric = isStatus4MetricKey(rawMetric) ? rawMetric : "current";
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear);
  const monthKey = decodeStatusFilterPart(rawMonthKey);
  const minValue = parseAmount(rawMin);
  const maxValue = parseAmount(rawMax);
  const fileFiscalYear = getFinancialYearForDate(file.receivedDate) ?? "undated";
  if (fiscalYear && fiscalYear !== "all" && fileFiscalYear !== fiscalYear) return false;
  if (monthKey && monthKey !== "all" && getMonthKey(file.receivedDate) !== monthKey) return false;
  if (!matchesValueRange(file, minValue, maxValue)) return false;
  return matchesStatus4Metric(file, milestone, metric);
}

type Status4MetricKey = "applicable" | "cleared" | "current";

function isStatus4MetricKey(value: string): value is Status4MetricKey {
  return value === "applicable" || value === "cleared" || value === "current";
}

function matchesStatus4Metric(file: FileRecord, milestone: string, metric: Status4MetricKey) {
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "financialsanction" || normalized === "supplyorder") {
    if (metric === "applicable") return countExpectedSupplyOrderRows(file) > 0;
    if (metric === "cleared") return matchesCompletedSupplyOrderDrivenMilestone(file, normalized);
    return matchesStatus4CurrentMilestone(file, milestone);
  }
  const definition = milestoneDefinitions.find(
    (item) =>
      normalizeMilestoneName(getMilestoneLabelAliases(item.key)[0] ?? item.key) === normalized,
  );
  if (!definition) {
    if (metric === "applicable") return !isCancelledFile(file);
    if (metric === "cleared") {
      return Boolean(
        file.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized),
      );
    }
    return matchesStatus4CurrentMilestone(file, milestone);
  }
  if (metric === "applicable") return isMilestoneApplicable(file, definition);
  if (metric === "cleared")
    return isMilestoneApplicable(file, definition) && isMilestoneComplete(file, definition);
  return matchesStatus4CurrentMilestone(file, milestone);
}

function matchesStatus4CurrentMilestone(file: FileRecord, milestone: string) {
  const normalized = normalizeMilestoneName(milestone);
  if (isBgMilestoneKey(normalized)) return isBgToBeReceived(file, normalized);
  if (normalized === "refloatbidding") {
    return !isCancelledFile(file) && isYes(file.refloat) && !isYes(file.biddingStageOver);
  }
  if (normalized === "refloatposttcec") {
    return (
      !isCancelledFile(file) &&
      isYes(file.refloat) &&
      isYes(file.tcec) &&
      isYes(file.biddingStageOver) &&
      !hasFilledString(file.refloatPostTcecMinutesDate)
    );
  }
  if (isSupplyOrderDrivenMilestoneName(milestone)) {
    return matchesCurrentSupplyOrderDrivenMilestone(file, normalized);
  }
  if (normalized === "bidding") {
    return (
      !isCancelledFile(file) &&
      isBiddingApplicableForFile(file) &&
      normalizeMilestoneName(file.currentMilestone) === "bidding"
    );
  }
  return !isCancelledFile(file) && file.currentMilestone === milestone;
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (!isCancellationDashboardFilter(filter) && isCancelledFile(file)) return false;
  if (filter.startsWith("delayFile:")) return file.id === filter.slice("delayFile:".length);
  if (filter.startsWith("financeCarryForward:")) {
    return matchesFinanceCarryForwardFilter(file, filter);
  }
  if (filter.startsWith("cashOutgoAny:")) return isCashOutgoAnyFilterMatch(file, filter);
  if (filter.startsWith("cashOutgo:")) return isCashOutgoFilterMatch(file, filter);
  if (filter.startsWith("status4:")) return matchesStatus4DashboardFilter(file, filter);
  if (filter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = filter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    return matchesStatusSummaryFilter(file, milestone, stage);
  }
  if (filter.startsWith("delayStatus:")) {
    const [, daysValue = "0", milestoneKey = "all"] = filter.split(":");
    return isDelayStatusMatch(file, getDelayThresholdDays(daysValue), milestoneKey);
  }
  if (filter.startsWith("biddingDelay:")) {
    const [, daysValue = "0", breakupKey = ""] = filter.split(":");
    return isBiddingDelayMatch(file, getDelayThresholdDays(daysValue), breakupKey);
  }
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    if (key === "psb") {
      if (value === "yes") return isPsbApplicableFile(file);
      if (value === "no") return !isPsbApplicableFile(file);
    }
    const fieldValue = String(file[key as keyof FileRecord] ?? "");
    if (value === "yes") return isYes(fieldValue);
    if (value === "no") return isNo(fieldValue);
  }
  if (filter.startsWith("firmType:")) {
    const firmType = decodeURIComponent(filter.slice("firmType:".length)).trim().toUpperCase();
    if (!firmType) return true;
    return fileSupplyOrders(file).some(
      (order) =>
        order.firmType?.trim().toUpperCase() === firmType ||
        order.firmTypeOther?.trim().toUpperCase() === firmType,
    );
  }
  if (filter.startsWith("gemBiddingMode:")) {
    const mode = decodeURIComponent(filter.slice("gemBiddingMode:".length)).trim().toLowerCase();
    return isYes(file.gem) && (file.gemBiddingMode ?? "").trim().toLowerCase() === mode;
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    const monthKey = filter.slice("supplyOrderMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return rawSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && getMonthKey(order.soDate) === monthKey,
    );
  }
  if (filter.startsWith("supplyOrderYear:")) {
    const yearKey = filter.slice("supplyOrderYear:".length);
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return true;
    return rawSupplyOrders(file).some(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasFilledString(order.soDate) &&
        (yearKey === "all" || order.soDate!.slice(0, 4) === yearKey),
    );
  }
  if (filter.startsWith("fileInflowMonth:")) {
    const monthKey = filter.slice("fileInflowMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return getMonthKey(file.receivedDate) === monthKey;
  }
  if (filter.startsWith("fileInflowYear:")) {
    const yearKey = filter.slice("fileInflowYear:".length);
    if (yearKey === "all") return hasFilledString(file.receivedDate);
    if (!/^\d{4}$/.test(yearKey)) return true;
    return file.receivedDate?.slice(0, 4) === yearKey;
  }
  if (filter.startsWith("fileCategory:")) {
    return matchesFileCategorySelection(
      file,
      normalizeFileCategories([filter.slice("fileCategory:".length)]),
    );
  }
  if (filter.startsWith("fileType:")) {
    const fileType = decodeURIComponent(filter.slice("fileType:".length));
    return (file.fileType ?? "").trim().toLowerCase() === fileType.trim().toLowerCase();
  }
  if (filter.startsWith("tcecStatusFy:")) return matchesTcecStatusFiscalYearFilter(file, filter);
  if (filter.startsWith("tcecStatus:")) return matchesTcecStatusFilter(file, filter);
  if (filter.startsWith("cncSummaryFy:")) return matchesCncSummaryFiscalYearFilter(file, filter);
  if (filter.startsWith("cncSummary:")) return matchesCncSummaryFilter(file, filter);
  if (filter.startsWith("mode:"))
    return (
      (file.mode ?? "").trim().toUpperCase() ===
      decodeURIComponent(filter.slice(5)).trim().toUpperCase()
    );
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return isBgToBeReceived(file);
    if (normalized === "refloatbidding") {
      return !isCancelledFile(file) && isYes(file.refloat) && !isYes(file.biddingStageOver);
    }
    if (normalized === "refloatposttcec") {
      return (
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return matchesCurrentSupplyOrderDrivenMilestone(file, milestone);
    }
    return !isCancelledFile(file) && file.currentMilestone === milestone;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return isBgReceived(file);
    if (normalized === "refloatbidding") {
      return !isCancelledFile(file) && isYes(file.refloat) && isYes(file.biddingStageOver);
    }
    if (normalized === "refloatposttcec") {
      return (
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return matchesCompletedSupplyOrderDrivenMilestone(file, milestone);
    }
    return Boolean(file.completedMilestones?.includes(milestone));
  }
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
  if (filter === "supplyOrders") return isSupplyOrderPlaced(file);
  if (filter === "liveSupplyOrders") return isLiveSupplyOrder(file);
  if (filter === "bgReceived") return isBgReceived(file);
  if (filter === "bgToBeReceived") return isBgToBeReceived(file);
  if (filter === "bgExpired") return isBgExpired(file);
  if (filter === "bgToBeReturned") return isBgToBeReturned(file);
  if (filter === "bgReturned") return isBgReturned(file);
  if (filter.startsWith("bgExpired:")) {
    const category = filter.slice("bgExpired:".length);
    return isBgMilestoneKey(category) ? isBgExpired(file, category) : true;
  }
  if (filter.startsWith("bgToBeReturned:")) {
    const category = filter.slice("bgToBeReturned:".length);
    return isBgMilestoneKey(category) ? isBgToBeReturned(file, category) : true;
  }
  if (filter.startsWith("bgReturned:")) {
    const category = filter.slice("bgReturned:".length);
    return isBgMilestoneKey(category) ? isBgReturned(file, category) : true;
  }
  if (filter === "dpExtension") return isYes(file.dpExtension);
  if (filter === "dpExpired") return isDpExpired(file);
  if (filter === "deliveryOverdue") return isDeliveryOverdue(file);
  if (filter === "deliveryDueToday") return isDeliveryDueToday(file);
  if (filter === "deliveryUpcoming") return isDeliveryUpcoming(file);
  if (filter === "deliveryCompleted") return isDeliveryCompleted(file);
  if (filter === "deliveryDeliveredLate") return isDeliveryDeliveredLate(file);
  if (filter === "deliveryDue") return isDeliveryDue(file);
  if (filter === "jobCompletionCompleted") return isJobCompletionCompleted(file);
  if (filter === "jobCompletionDue" || filter === "jobCompletionLive")
    return isJobCompletionLive(file);
  if (filter === "jobCompletionPeriodOver") return isJobCompletionPeriodOver(file);
  if (filter === "deliveryPeriodValid") return isDeliveryPeriodValid(file);
  if (filter === "deliveryPeriodExpired") return isDeliveryPeriodExpired(file);
  if (filter === "deliveryPeriodExtended") return isDeliveryPeriodExtended(file);
  if (filter === "irPreparationPending") return isIrPreparationPending(file);
  if (filter === "irReceiptPending") return isIrReceiptPending(file);
  if (filter === "irCompleted") return isIrCompleted(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "advancePaid") return hasAdvancePaymentPaid(file);
  if (filter === "advancePending") return hasAdvancePaymentPending(file);
  if (filter === "miscLiveFiles") return !isFileClosed(file) && !isCancelledFile(file);
  if (filter === "miscFileClosed") return isFileClosed(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled") return isYes(file.demandCancelled);
  if (filter === "miscSoCancelled")
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  if (filter === "miscShortclosedSo")
    return fileSupplyOrders(file).some((order) => isYes(order.shortclosure));
  if (filter === "miscMultipleSupplyOrders") return countExpectedSupplyOrderRows(file) > 1;
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
    if (milestone.key === "payment") return isPaymentPending(file) || isPaymentCompleted(file);
    return isBgMilestoneKey(milestone.key)
      ? fileSupplyOrders(file).some((order) => isBgCategoryApplicable(file, order, milestone.key))
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    if (milestone?.key === "refloatPostTcec") {
      return isYes(file.refloat) && !isYes(file.biddingStageOver);
    }
    if (milestone?.key === "refloatBidding") return false;
    return milestone ? isAtPreviousStageFile(file, milestone) : true;
  }
  if (filter.startsWith("milestoneActive:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(16));
    if (!milestone) return true;
    if (milestone.key === "refloatBidding") {
      return isYes(file.refloat) && !isYes(file.biddingStageOver);
    }
    if (milestone.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
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
    if (milestone?.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        hasFilledString(file.refloatPostTcecDate) &&
        !hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
    return milestone ? isMilestoneReviewed(file, milestone) : true;
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (milestone?.key === "refloatBidding") {
      return isYes(file.refloat) && !isYes(file.biddingStageOver);
    }
    if (milestone?.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
    if (milestone?.key === "payment") return isPaymentPending(file);
    if (milestone && isBgMilestoneKey(milestone.key)) return isBgToBeReceived(file, milestone.key);
    if (milestone?.key === "supplyOrder") {
      return matchesCurrentSupplyOrderDrivenMilestone(file, "supplyorder");
    }
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (!milestone) return true;
    if (milestone.key === "refloatBidding") {
      return isYes(file.refloat) && isYes(file.biddingStageOver);
    }
    if (milestone.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) && isYes(file.tcec) && hasFilledString(file.refloatPostTcecMinutesDate)
      );
    }
    if (milestone.key === "payment") return isPaymentCompleted(file);
    if (isBgMilestoneKey(milestone.key)) return isBgReceived(file, milestone.key);
    return isClearedMilestone(file, milestone);
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isEligibleMilestone(file, milestone) : true;
  }
  if (filter === "soCompleted") return hasPlacedSupplyOrder(file);
  if (filter === "soRemaining") return hasCurrentSupplyOrderMilestoneRow(file);
  return true;
}

function matchesTcecStatusFilter(file: FileRecord, filter: string) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawCommittee = "", rawMeetingDate = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return false;
  const committee = decodeStatusFilterPart(rawCommittee).trim().toLowerCase();
  if (!committee) return false;
  const meetingDate = decodeStatusFilterPart(rawMeetingDate).trim();
  const fileCommittee = getTcecCommittee(file, stage);
  if ((fileCommittee ?? "").toLowerCase() !== committee) return false;
  const minutesDate = getTcecMinutesDate(file, stage);
  const fileMeetingDate = getTcecMeetingDate(file, stage);
  if (metric === "signed" && !hasFilledString(minutesDate)) return false;
  if (metric === "pending" && hasFilledString(minutesDate)) return false;
  if (meetingDate && fileMeetingDate !== meetingDate) return false;
  return true;
}

function matchesTcecStatusFiscalYearFilter(file: FileRecord, filter: string) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawFiscalYear = "", rawCommittee = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return false;
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear).trim();
  const committee = decodeStatusFilterPart(rawCommittee).trim().toLowerCase();
  const fileCommittee = getTcecCommittee(file, stage);
  if (committee && (fileCommittee ?? "").toLowerCase() !== committee) return false;
  const meetingDate = getTcecMeetingDate(file, stage);
  if (!hasFilledString(meetingDate)) return false;
  if (fiscalYear !== "all" && getFinancialYearForDate(meetingDate) !== fiscalYear) return false;
  const minutesDate = getTcecMinutesDate(file, stage);
  if (metric === "signed" && !hasFilledString(minutesDate)) return false;
  if (metric === "pending" && hasFilledString(minutesDate)) return false;
  return true;
}

function matchesCncSummaryFilter(file: FileRecord, filter: string) {
  const [, rawMetric = "reviewed", rawCncDate = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const cncDate = decodeStatusFilterPart(rawCncDate).trim();
  if (!cncDate || file.cncDate !== cncDate) return false;
  const approved = hasFilledString(file.cncApprovalDate);
  const financialSanctionSigned = hasOrderFinancialSanctionCompleted(file);
  const supplyOrderPlaced = hasPlacedSupplyOrder(file);
  if (metric === "name" || metric === "reviewed") return true;
  if (metric === "approved") return approved;
  if (metric === "financialSanctionSigned") return financialSanctionSigned;
  if (metric === "supplyOrderPlaced") return supplyOrderPlaced;
  if (metric === "approvalPending") return !approved;
  if (metric === "financialSanctionPending") return approved && !financialSanctionSigned;
  if (metric === "supplyOrderPending") return financialSanctionSigned && !supplyOrderPlaced;
  return false;
}

function matchesCncSummaryFiscalYearFilter(file: FileRecord, filter: string) {
  const [, rawMetric = "reviewed", rawFiscalYear = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear).trim();
  if (!hasFilledString(file.cncDate)) return false;
  if (fiscalYear !== "all" && getFinancialYearForDate(file.cncDate) !== fiscalYear) return false;
  const approved = hasFilledString(file.cncApprovalDate);
  const financialSanctionSigned = hasOrderFinancialSanctionCompleted(file);
  const supplyOrderPlaced = hasPlacedSupplyOrder(file);
  if (metric === "name" || metric === "reviewed") return true;
  if (metric === "approved") return approved;
  if (metric === "financialSanctionSigned") return financialSanctionSigned;
  if (metric === "supplyOrderPlaced") return supplyOrderPlaced;
  if (metric === "approvalPending") return !approved;
  if (metric === "financialSanctionPending") return approved && !financialSanctionSigned;
  if (metric === "supplyOrderPending") return financialSanctionSigned && !supplyOrderPlaced;
  return false;
}

function isCancellationDashboardFilter(filter: string) {
  return (
    filter === "miscDemandCancelled" ||
    filter === "miscSoCancelled" ||
    filter === "miscShortclosedSo"
  );
}

function hasOrderFinancialSanctionCompleted(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) => !isSupplyOrderCancelled(file, order) && hasFilledString(order.financialSanctionDate),
  );
}

function decodeStatusFilterPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchesStatusSummaryFilter(file: FileRecord, milestoneLabel: string, stageLabel: string) {
  const rawMilestoneKey = normalizeMilestoneName(milestoneLabel);
  const milestoneKey = rawMilestoneKey === "deliveryjob" ? "delivery" : rawMilestoneKey;
  const stageKey = normalizeStatusStage(stageLabel);

  if (milestoneKey === "supplyorder") {
    if (stageKey === "placed")
      return matchesCompletedSupplyOrderDrivenMilestone(file, "supplyorder");
    if (stageKey === "live") return hasLiveSupplyOrderRow(file);
    if (stageKey === "pending") return hasCurrentSupplyOrderMilestoneRow(file);
  }

  if (milestoneKey === "financialsanction") {
    const completed = matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction");
    const pending = matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction");
    if (stageKey === "total" || stageKey === "totalfiles") return completed;
    if (stageKey === "pending") return pending;
  }

  if (milestoneKey === "advancepayment") {
    if (stageKey === "completed") return hasAdvancePaymentPaid(file);
    if (stageKey === "pending") return hasAdvancePaymentPending(file);
  }

  if (milestoneKey === "billreturnedforcorrection") {
    const orders = filePaymentOrders(file).filter((order) => isPaymentOrderActive(file, order));
    if (stageKey === "total") return orders.some(hasReturnedBill);
    if (stageKey === "pending") return orders.some(hasOpenBillReturn);
    if (stageKey === "completed") return orders.some(hasCompletedBillReturn);
    if (stageKey === "returnedpaid") return orders.some(hasReturnedBillPaid);
  }

  if (milestoneKey === "bankguarantee") {
    if (stageKey === "received")
      return matchesCompletedSupplyOrderDrivenMilestone(file, "bankguarantee");
    if (stageKey === "pending") return isBgToBeReceived(file);
    if (stageKey === "expired") return isBgExpired(file);
    if (stageKey === "tobereturned") return isBgToBeReturned(file);
  }

  if (isBgMilestoneKey(milestoneKey)) {
    if (stageKey === "received") return isBgReceived(file, milestoneKey);
    if (stageKey === "pending") return isBgToBeReceived(file, milestoneKey);
    if (stageKey === "expired") return isBgExpired(file, milestoneKey);
    if (stageKey === "tobereturned") return isBgToBeReturned(file, milestoneKey);
    if (stageKey === "returned") return isBgReturned(file, milestoneKey);
  }

  if (milestoneKey === "deliveryperiod") {
    if (stageKey === "valid") return isDeliveryPeriodValid(file);
    if (stageKey === "expired") return isDeliveryPeriodExpired(file);
    if (stageKey === "extended") return isDeliveryPeriodExtended(file);
  }

  if (milestoneKey === "delivery") {
    if (stageKey === "completed") return isDeliveryCompleted(file);
    if (stageKey === "pending") return matchesDeliveryPendingStatus(file);
    if (stageKey === "overdue") return matchesDeliveryOverdueStatus(file);
  }

  if (milestoneKey === "jobcompletion") {
    if (stageKey === "due" || stageKey === "livemilestone") return isJobCompletionLive(file);
    if (stageKey === "done" || stageKey === "completed") return isJobCompletionCompleted(file);
  }

  if (milestoneKey === "payment") {
    if (stageKey === "completed") return isPaymentCompleted(file);
    if (stageKey === "pending") return isPaymentPending(file);
    if (stageKey === "total" || stageKey === "totalfiles") {
      return isPaymentPending(file) || isPaymentCompleted(file);
    }
  }

  if (
    milestoneKey === "irpreparation" ||
    milestoneKey === "irreceipt" ||
    milestoneKey === "billpreparation" ||
    milestoneKey === "billsentforpayment"
  ) {
    if (stageKey === "completed")
      return matchesCompletedSupplyOrderDrivenMilestone(file, milestoneKey);
    if (stageKey === "pending") return matchesCurrentSupplyOrderDrivenMilestone(file, milestoneKey);
    if (stageKey === "total" || stageKey === "totalfiles") {
      return (
        matchesCompletedSupplyOrderDrivenMilestone(file, milestoneKey) ||
        matchesCurrentSupplyOrderDrivenMilestone(file, milestoneKey)
      );
    }
  }

  const milestone = milestoneDefinitions.find(
    (item) =>
      normalizeMilestoneName(item.key) === milestoneKey ||
      getMilestoneLabelAliases(item.key).some(
        (label) => normalizeMilestoneName(label) === milestoneKey,
      ),
  );
  if (!milestone) return false;

  const applicable = isMilestoneApplicable(file, milestone);
  const inProcess = applicable && !isCancelledFile(file);
  const reached = inProcess && isEligibleMilestone(file, milestone);

  if (stageKey === "total" || stageKey === "totalfiles" || stageKey === "totalcases") {
    return applicable;
  }
  if (stageKey === "inprocess") {
    if (milestone.key === "bidding") {
      return (
        isManualActiveMilestone(file, milestone) && !isFileTenderLive(file) && !isBidOverdue(file)
      );
    }
    return isManualActiveMilestone(file, milestone);
  }
  if (stageKey === "reviewed") return isMilestoneReviewed(file, milestone);
  if (stageKey === "pending") return isPendingMilestone(file, milestone);
  if (stageKey === "completed") return inProcess && isMilestoneComplete(file, milestone);
  if (stageKey === "live" && milestone.key === "bidding") return isFileTenderLive(file);
  if (stageKey === "openingoverdue" && milestone.key === "bidding") return isBidOverdue(file);
  if (stageKey === "atpreviousstage" || stageKey === "atpreviousstages")
    return isAtPreviousStageFile(file, milestone);

  return false;
}

function normalizeStatusStage(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasPlacedSupplyOrder(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) => isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
  );
}

function hasLiveSupplyOrderRow(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function hasCurrentSupplyOrderMilestoneRow(file: FileRecord) {
  return expectedSupplyOrders(file).some((order) => isSupplyOrderPendingOrder(file, order));
}

function isSupplyOrderDrivenMilestoneName(name: string) {
  const normalized = normalizeMilestoneName(name);
  return supplyOrderMilestoneNames.some(
    (milestone) => normalizeMilestoneName(milestone) === normalized,
  );
}

function shouldUseOrderMilestoneRows(file: FileRecord) {
  return countExpectedSupplyOrderRows(file) > 1 || rawSupplyOrders(file).length > 0;
}

function isFinancialSanctionReached(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    (isBiddingApplicableForFile(file)
      ? isYes(file.biddingStageOver)
      : hasFilledString(file.cfaDate)) &&
    (!isYes(file.tcec) || hasFilledString(file.cncApprovalDate))
  );
}

function isFinancialSanctionPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isFinancialSanctionReached(file) &&
    !isSupplyOrderCancelled(file, order) &&
    !isFinancialSanctionCompletedOrder(order)
  );
}

function getEffectiveOrderCurrentMilestone(file: FileRecord, order: SupplyOrderDetail) {
  return getCanonicalSupplyOrderCurrentMilestone(file, order);
}

function isBgMilestoneKey(key: string) {
  const normalized = normalizeMilestoneName(key);
  return normalized === "psb" || normalized === "pwb" || normalized === "psbpwb";
}

function isBgCategoryApplicable(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "bankguarantee") return isYes(file.bg);
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
  return "";
}

function getBgValidityDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgValidityDate;
  if (normalized === "pwb") return order.pwbBgValidityDate;
  if (normalized === "psbpwb") return order.combinedBgValidityDate;
  return "";
}

function getBgReturnDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgReturnDate;
  if (normalized === "pwb") return order.pwbBgReturnDate;
  if (normalized === "psbpwb") return order.combinedBgReturnDate;
  return "";
}

function isOrderCurrentForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isCanonicalSupplyOrderMilestoneCurrent(file, order, normalizedMilestone);
}

function getOrderDelayCurrentMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  if (normalizedMilestone === "advancepayment") {
    return normalizeMilestoneName(order.advancePaymentDetail?.currentMilestone);
  }
  if (isOrderCurrentForMilestone(file, order, normalizedMilestone)) {
    return normalizedMilestone;
  }
  return getEffectiveOrderCurrentMilestone(file, order);
}

function supplyOrderMilestoneRows(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "financialsanction") return expectedSupplyOrders(file);
  if (normalizedMilestone === "advancepayment") return rawSupplyOrders(file);
  if (
    normalizedMilestone === "supplyorder" ||
    normalizedMilestone === "bankguarantee" ||
    isBgMilestoneKey(normalizedMilestone)
  ) {
    return expectedSupplyOrders(file);
  }
  if (isPaymentMilestone(normalizedMilestone)) {
    return filePaymentOrders(file);
  }
  return fileSupplyOrders(file);
}

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "advancepayment") {
    return advancePaymentEntries([file]).some(
      ({ file: entryFile, order }) =>
        isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
    );
  }
  if (normalizedMilestone === "bankguarantee") return isYes(file.bg);
  if (isBgMilestoneKey(normalizedMilestone)) {
    return fileSupplyOrders(file).some((order) =>
      isBgCategoryApplicable(file, order, normalizedMilestone),
    );
  }
  if (normalizedMilestone === "delivery") return isDeliveryInspectionApplicable(file);
  if (normalizedMilestone === "jobcompletion") return isJobCompletionWorkflow(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return isYes(file.ir);
  }
  return true;
}

function matchesCurrentSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  const normalized = normalizeMilestoneName(milestone);
  if (isYes(file.demandCancelled)) return false;
  if (!isPaymentMilestone(normalized) && isCancelledFile(file)) return false;
  if (normalized === "advancepayment") return hasAdvancePaymentPending(file);
  if (normalized === "payment") return isPaymentPending(file);
  if (normalized === "jobcompletion") {
    return normalizedSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) &&
        isOrderCurrentForMilestone(entryFile, order, normalized),
    );
  }
  if (!shouldUseOrderMilestoneRows(file)) {
    if (normalized === "financialsanction") {
      return (
        isFinancialSanctionReached(file) &&
        !matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")
      );
    }
    return normalizeMilestoneName(file.currentMilestone) === normalized;
  }
  return supplyOrderMilestoneRows(file, normalized).some(
    (order) =>
      isOrderActiveForCurrentMilestone(file, order, normalized) &&
      isOrderCurrentForMilestone(file, order, normalized),
  );
}

function matchesDeliveryPendingStatus(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
    )
  );
}

function matchesDeliveryOverdueStatus(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(file, order),
    )
  );
}

function matchesCompletedSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  const normalized = normalizeMilestoneName(milestone);
  if (isYes(file.demandCancelled)) return false;
  if (!isPaymentMilestone(normalized) && isCancelledFile(file)) return false;
  if (normalized === "supplyorder") return hasPlacedSupplyOrder(file);
  if (normalized === "advancepayment") {
    return advancePaymentEntries([file]).some(
      ({ file: entryFile, order }) =>
        isAdvancePaymentPaid(order) && isPaymentOrderActive(entryFile, order),
    );
  }
  if (normalized === "billsentforpayment") return hasCompletedBillSentForPaymentOrder(file);
  if (normalized === "billreturnedforcorrection") return hasResolvedBillReturnOrder(file);
  if (!shouldUseOrderMilestoneRows(file)) {
    if (normalized === "financialsanction") {
      return Boolean(
        fileSupplyOrders(file).some(
          (order) =>
            !isSupplyOrderCancelled(file, order) && hasFilledString(order.financialSanctionDate),
        ),
      );
    }
    return Boolean(
      file.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized),
    );
  }
  return supplyOrderMilestoneRows(file, normalized).some(
    (order) =>
      isOrderActiveForMilestone(file, order, normalized) &&
      (normalized === "financialsanction"
        ? hasFilledString(order.financialSanctionDate)
        : normalized === "billsentforpayment"
          ? !hasOpenBillReturn(order) && hasFilledString(order.billSentForPaymentDate)
          : normalized === "billreturnedforcorrection"
            ? hasCompletedBillReturn(order)
            : order.completedMilestones?.some(
                (item) => normalizeMilestoneName(item) === normalized,
              )),
  );
}

function hasCompletedBillSentForPaymentOrder(file: FileRecord) {
  return filePaymentOrders(file).some(
    (order) =>
      isPaymentOrderActive(file, order) &&
      !hasOpenBillReturn(order) &&
      (hasFilledString(order.billSentForPaymentDate) ||
        order.completedMilestones?.some(
          (item) => normalizeMilestoneName(item) === "billsentforpayment",
        )),
  );
}

function hasResolvedBillReturnOrder(file: FileRecord) {
  return filePaymentOrders(file).some(
    (order) => isPaymentOrderActive(file, order) && hasCompletedBillReturn(order),
  );
}

function getMonthKey(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{4}-\d{2}/.test(trimmed) ? trimmed.slice(0, 7) : "";
}
