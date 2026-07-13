import type { AppSettings, Division, FileRecord, SupplyOrderDetail } from "../types.js";
import {
  countSupplyOrderRows as normalizedCountSupplyOrderRows,
  effectivePaymentEntries as normalizedPaymentEntries,
  effectiveSupplyOrderEntries as normalizedSupplyOrderEntries,
  fileSupplyOrders as normalizedFileSupplyOrders,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
} from "./effective-deliveries.js";
import { allFileCategoryKeys, matchesFileCategorySelection } from "./file-categories.js";

export type DashboardSummary = ReturnType<typeof buildDashboardSummary>;

const defaultManualMilestones = [
  "Scrutiny",
  "High Value",
  "Pre-TCEC",
  "AD",
  "R&QA",
  "Controlling",
  "IFA",
  "CFA",
  "Bidding",
  "Post-TCEC",
  "CNC",
  "Supply Order",
  "Delivery Period",
  "Bank Guarantee",
  "Delivery",
  "Bill sent for payment",
  "Payment",
  "File Closed",
];
const fileClosedMilestone = "File Closed";
const supplyOrderMilestoneNames = [
  "Supply Order",
  "Bank Guarantee",
  "Delivery",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Payment",
];

const snapshotAttributeDefinitions = [
  { key: "tcec", label: "TCEC", yesLabel: "TCEC", noLabel: "Non TCEC" },
  { key: "gte", label: "GTE", yesLabel: "GTE", noLabel: "Non GTE" },
  { key: "gem", label: "GeM", yesLabel: "GeM", noLabel: "Non GeM" },
  { key: "highValue", label: "High Value", yesLabel: "High Value", noLabel: "Non High Value" },
  { key: "ad", label: "AD", yesLabel: "AD", noLabel: "Non AD" },
  { key: "rqa", label: "R&QA", yesLabel: "R&QA", noLabel: "Non R&QA" },
  { key: "ifa", label: "IFA", yesLabel: "IFA", noLabel: "Non IFA" },
  { key: "psb", label: "PSB", yesLabel: "PSB", noLabel: "Non PSB" },
  { key: "bg", label: "BG", yesLabel: "BG", noLabel: "Non BG" },
  { key: "rfpVetting", label: "RFP vetting", yesLabel: "RFP vetting", noLabel: "Non RFP vetting" },
  { key: "refloat", label: "Refloat", yesLabel: "Refloat", noLabel: "Non Refloat" },
  { key: "rst", label: "RST", yesLabel: "RST", noLabel: "Non RST" },
] satisfies Array<{
  key: keyof FileRecord;
  label: string;
  yesLabel: string;
  noLabel: string;
}>;

const milestoneDefinitions = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    totalLabel: "Total files",
    reviewed: "scrutinyDate",
    current: "scrutinyCompletionDate",
  },
  {
    key: "highValue",
    label: "High Value",
    totalLabel: "Total cases",
    reviewed: "highValueMeetingDate",
    current: "highValueMinutesDate",
    applies: (file: FileRecord) => isYes(file.highValue),
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    totalLabel: "Total cases",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "ad",
    label: "AD",
    totalLabel: "Total cases",
    current: "adVettingDate",
    applies: (file: FileRecord) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    current: "rqaApprovalDate",
    applies: (file: FileRecord) => isYes(file.rqa),
  },
  { key: "control", label: "Controlling", totalLabel: "Total files", current: "immsDate" },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file: FileRecord) => isYes(file.ifa),
  },
  {
    key: "cfa",
    label: "CFA",
    totalLabel: "Total files",
    reviewed: "cfaSentDate",
    current: "cfaDate",
  },
  { key: "bidding", label: "Bidding", totalLabel: "Total files", current: "biddingStageOver" },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    current: "soDate",
  },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "bgValidityDate",
    applies: (file: FileRecord) => isYes(file.bg),
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", current: "paymentDate" },
] satisfies Array<{
  key: string;
  label: string;
  completedLabel?: string;
  totalLabel?: string;
  pendingLabel?: string;
  reviewed?: keyof FileRecord | keyof SupplyOrderDetail;
  current: keyof FileRecord | keyof SupplyOrderDetail;
  applies?: (file: FileRecord) => boolean;
}>;

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "soDate",
  "bgValidityDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
]);

export function buildDashboardSummary({
  files,
  divisions,
  settings,
  division = "all",
  analyticsDivision = "all",
  liveMilestones,
}: {
  files: FileRecord[];
  divisions: Division[];
  settings: AppSettings;
  division?: string;
  analyticsDivision?: string;
  liveMilestones?: string[];
}) {
  const activeDivision =
    division === "all" || divisions.some((item) => item.name === division) ? division : "all";
  const dashboardFiles =
    activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision);
  const activeDashboardFiles = dashboardFiles.filter((file) => !isCancelledFile(file));
  const dashboardDivisions =
    activeDivision === "all" ? divisions : divisions.filter((item) => item.name === activeDivision);
  const activeAnalyticsDivision =
    analyticsDivision === "all" || divisions.some((item) => item.name === analyticsDivision)
      ? analyticsDivision
      : "all";
  const filteredAnalyticsFiles =
    activeAnalyticsDivision === "all"
      ? activeDashboardFiles
      : files
          .filter((file) => file.division === activeAnalyticsDivision)
          .filter((file) => !isCancelledFile(file));
  const filteredAnalyticsDivisions =
    activeAnalyticsDivision === "all"
      ? dashboardDivisions
      : divisions.filter((item) => item.name === activeAnalyticsDivision);
  const manualMilestoneFlow = getManualMilestoneFlow(
    activeDashboardFiles,
    getConfiguredMilestones(settings.milestones),
  );
  const visibleLiveMilestoneNames =
    liveMilestones?.filter((name) =>
      manualMilestoneFlow.some((milestone) => milestone.name === name),
    ) ?? manualMilestoneFlow.map((milestone) => milestone.name);
  const financeTotals = getFinanceTotals(activeDashboardFiles, dashboardDivisions);

  return {
    activeDivision,
    activeAnalyticsDivision,
    dashboardFileCount: activeDashboardFiles.length,
    dashboardDivisions,
    modeCounts: getModeCounts(activeDashboardFiles, settings.modes),
    topSummaryStats: getAttributeSummaryStats(activeDashboardFiles),
    fileTypeStats: getFileTypeSummaryStats(activeDashboardFiles),
    firmTypeStats: getFirmTypeSummaryStats(activeDashboardFiles, settings.firmTypes),
    manualMilestoneFlow,
    visibleLiveMilestoneNames,
    liveStatusRows: getLiveStatusDivisionRows(
      activeDashboardFiles,
      dashboardDivisions,
      visibleLiveMilestoneNames,
    ),
    statusFlow: getMilestoneFlow(activeDashboardFiles),
    miscellaneousCounts: getMiscellaneousCounts(dashboardFiles),
    analytics: getAnalyticsSummary(
      activeDashboardFiles,
      dashboardDivisions,
      settings.valueThresholdLevels,
    ),
    divisionFilteredAnalytics: getAnalyticsSummary(
      filteredAnalyticsFiles,
      filteredAnalyticsDivisions,
      settings.valueThresholdLevels,
    ),
    financeTotals,
    financeFirmTypeDistributions: {
      supplyOrderValue: getSupplyOrderValueDistributionByFirmType(
        activeDashboardFiles,
        settings.firmTypes,
      ),
      actualPayment: getActualPaymentDistributionByFirmType(
        activeDashboardFiles,
        settings.firmTypes,
      ),
    },
    financePercents: {
      capitalBooked: getPercent(financeTotals.bookedCapital, financeTotals.allocatedCapital),
      revenueBooked: getPercent(financeTotals.bookedRevenue, financeTotals.allocatedRevenue),
      capitalProjected: getPercent(financeTotals.projectedCapital, financeTotals.allocatedCapital),
      revenueProjected: getPercent(financeTotals.projectedRevenue, financeTotals.allocatedRevenue),
      capitalSpent: getPercent(financeTotals.spentCapital, financeTotals.allocatedCapital),
      revenueSpent: getPercent(financeTotals.spentRevenue, financeTotals.allocatedRevenue),
    },
  };
}

function getFinanceTotals(files: FileRecord[], divisions: Division[]) {
  const actualPaymentEntries = effectivePaymentEntries(files).filter(
    ({ file, order }) => !isSupplyOrderCancelled(file, order),
  );
  return {
    allocatedCapital: divisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedCapital) ?? 0),
      0,
    ),
    allocatedRevenue: divisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedRevenue) ?? 0),
      0,
    ),
    bookedCapital: files.reduce(
      (sum, file) =>
        sum +
        (isCancelledFile(file)
          ? 0
          : hasFilledField(file, "imms") && getFileCommittedCapitalValue(file) <= 0
            ? (getInrAmount(file.valueCapital, file) ?? 0)
            : 0),
      0,
    ),
    bookedRevenue: files.reduce(
      (sum, file) =>
        sum +
        (isCancelledFile(file)
          ? 0
          : hasFilledField(file, "imms") && getFileCommittedRevenueValue(file) <= 0
            ? (getInrAmount(file.valueRevenue, file) ?? 0)
            : 0),
      0,
    ),
    projectedCapital: files.reduce(
      (sum, file) =>
        sum +
        (!isCancelledFile(file) && !hasFilledField(file, "imms")
          ? (getInrAmount(file.valueCapital, file) ?? 0)
          : 0),
      0,
    ),
    projectedRevenue: files.reduce(
      (sum, file) =>
        sum +
        (!isCancelledFile(file) && !hasFilledField(file, "imms")
          ? (getInrAmount(file.valueRevenue, file) ?? 0)
          : 0),
      0,
    ),
    spentCapital: files.reduce(
      (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedCapitalValue(file)),
      0,
    ),
    spentRevenue: files.reduce(
      (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedRevenueValue(file)),
      0,
    ),
    paidCapital: actualPaymentEntries.reduce(
      (sum, { file, order }) => sum + (getInrAmount(order.actualPaymentCapital, file) ?? 0),
      0,
    ),
    paidRevenue: actualPaymentEntries.reduce(
      (sum, { file, order }) => sum + (getInrAmount(order.actualPaymentRevenue, file) ?? 0),
      0,
    ),
  };
}

function getModeCounts(files: FileRecord[], configuredModes: string[] | undefined) {
  const modes = getConfiguredModes(
    configuredModes,
    files.map((file) => file.mode),
  );
  const counts = files.reduce<Record<string, number>>((current, file) => {
    const mode = file.mode?.trim().toUpperCase();
    if (!mode) return current;
    current[mode] = (current[mode] ?? 0) + 1;
    return current;
  }, {});
  return modes.map((name) => ({ name, count: counts[name] ?? 0 }));
}

function getConfiguredModes(
  configuredModes: string[] | undefined,
  existingModes: Array<string | undefined>,
) {
  const defaults = ["OBM", "PBM", "SBM", "LBM", "LPC"];
  const seen = new Set<string>();
  return [...(configuredModes?.length ? configuredModes : defaults), ...existingModes]
    .map((mode) => mode?.trim().toUpperCase() ?? "")
    .filter((mode) => {
      if (!mode) return false;
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    });
}

function getAttributeSummaryStats(files: FileRecord[]) {
  return snapshotAttributeDefinitions.map((attribute) => ({
    label: attribute.label,
    value: [
      {
        label: attribute.yesLabel,
        value: files.filter((file) => isYes(String(file[attribute.key] ?? ""))).length,
        searchFilter: `attribute:${attribute.key}:yes`,
      },
      {
        label: attribute.noLabel,
        value: files.filter((file) => isNo(String(file[attribute.key] ?? ""))).length,
        searchFilter: `attribute:${attribute.key}:no`,
      },
    ],
    hint: `${attribute.yesLabel} and ${attribute.noLabel} files`,
  }));
}

function getFileTypeSummaryStats(files: FileRecord[]) {
  const fileTypeKeys = allFileCategoryKeys;
  const labels: Record<(typeof fileTypeKeys)[number], string> = {
    goodsServices: "Goods & Services",
    amc: "AMC",
    mpc: "MPC",
    cars: "CARS",
    om: "O&M",
  };
  return {
    label: "File Type",
    value: fileTypeKeys.map((key) => ({
      label: labels[key],
      value: files.filter((file) => matchesFileCategorySelection(file, [key])).length,
      searchFilter: `fileCategory:${key}`,
    })),
    hint: "Files grouped by file type",
  };
}

function getFirmTypeSummaryStats(files: FileRecord[], firmTypes: string[] | undefined) {
  return {
    label: "Firm Type",
    value: getConfiguredFirmTypes(firmTypes).map((firmType) => ({
      label: firmType,
      value: files.filter((file) =>
        normalizedFileSupplyOrders(file).some((order) => isFirmTypeMatch(order, firmType)),
      ).length,
      searchFilter: `firmType:${encodeURIComponent(firmType)}`,
    })),
    hint: "Files grouped by supply order firm type",
  };
}

function getConfiguredFirmTypes(firmTypes: string[] | undefined) {
  const defaults = ["MSE", "MSE (Women)", "Non-MSE"];
  const seen = new Set<string>();
  return (firmTypes?.length ? firmTypes : defaults)
    .map((firmType) => firmType.trim())
    .filter((firmType) => {
      if (!firmType) return false;
      const key = firmType.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isFirmTypeMatch(order: SupplyOrderDetail, firmType: string) {
  const expected = firmType.trim().toUpperCase();
  return (
    order.firmType?.trim().toUpperCase() === expected ||
    order.firmTypeOther?.trim().toUpperCase() === expected
  );
}

function getMiscellaneousCounts(files: FileRecord[]) {
  const activeFiles = files.filter((file) => !isCancelledFile(file));
  return {
    liveFiles: activeFiles.filter((file) => !isFileClosed(file)).length,
    fileClosed: activeFiles.filter(isFileClosed).length,
    ld: countLdOrders(activeFiles),
    demandCancelled: files.filter((file) => isYes(file.demandCancelled)).length,
    soCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.soCancelled)),
    ).length,
    multipleSupplyOrders: activeFiles.filter((file) => normalizedCountSupplyOrderRows(file) > 1)
      .length,
  };
}

function getManualMilestoneFlow(files: FileRecord[], milestones: string[]) {
  const configured = milestones
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => normalizeMilestoneName(name) !== normalizeMilestoneName(fileClosedMilestone));
  const extras = files
    .map((file) => file.currentMilestone?.trim())
    .filter((name): name is string => Boolean(name))
    .filter((name) => !configured.includes(name));
  return [...configured, ...Array.from(new Set(extras)).sort()].map((name) => ({
    name,
    current: getManualMilestoneCurrentCount(files, name),
    completed: getManualMilestoneCompletedCount(files, name),
  }));
}

function getManualMilestoneCurrentCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isSupplyOrderDrivenMilestoneName(name)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.currentMilestone === name).length;
}

function getManualMilestoneCompletedCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isSupplyOrderDrivenMilestoneName(name)) {
    return countCompletedSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.completedMilestones?.includes(name))
    .length;
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(insertBillSentMilestone(configured));
}

function appendFileClosedMilestone(milestones: string[]) {
  const withoutFileClosed = milestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function insertBillSentMilestone(milestones: string[]) {
  const hasBillSent = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "billsentforpayment",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasBillSent || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Bill sent for payment",
    ...milestones.slice(paymentIndex),
  ];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function getLiveStatusDivisionRows(
  files: FileRecord[],
  divisions: Division[],
  milestoneNames: string[],
) {
  const configuredDivisionNames = divisions.map((division) => division.name);
  const fileDivisionNames = Array.from(
    new Set(
      files.map((file) => file.division?.trim()).filter((name): name is string => Boolean(name)),
    ),
  );
  const divisionNames = Array.from(new Set([...configuredDivisionNames, ...fileDivisionNames]));
  return divisionNames
    .map((division) => {
      const divisionFiles = files.filter((file) => file.division === division);
      const counts = Object.fromEntries(
        milestoneNames.map((milestoneName) => [
          milestoneName,
          getLiveStatusMilestoneCount(divisionFiles, milestoneName),
        ]),
      ) as Record<string, number>;
      return {
        division,
        counts,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.division.localeCompare(b.division));
}

function isPaymentMilestoneName(name: string) {
  return normalizeMilestoneName(name) === "payment";
}

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((milestone) => milestone.trim()).filter(Boolean)));
}

function getLiveStatusMilestoneCount(files: FileRecord[], milestoneName: string) {
  const normalized = normalizeMilestoneName(milestoneName);
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.currentMilestone === milestoneName)
    .length;
}

function isSupplyOrderDrivenMilestoneName(name: string) {
  const normalized = normalizeMilestoneName(name);
  return supplyOrderMilestoneNames.some(
    (milestone) => normalizeMilestoneName(milestone) === normalized,
  );
}

function shouldUseOrderMilestoneRows(file: FileRecord) {
  return (
    normalizedCountSupplyOrderRows(file) > 1 ||
    rawSupplyOrders(file).some((order) => isYes(order.stagePayment))
  );
}

function getEffectiveOrderCurrentMilestone(file: FileRecord, order: SupplyOrderDetail) {
  const current = normalizeMilestoneName(order.currentMilestone);
  if (current && isOrderMilestoneApplicable(file, current)) return current;
  return "";
}

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "bankguarantee") return isYes(file.bg);
  if (normalizedMilestone === "delivery") return isDeliveryInspectionApplicable(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return isYes(file.ir);
  }
  return true;
}

function countCurrentSupplyOrderMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (!shouldUseOrderMilestoneRows(file)) {
      return total + (normalizeMilestoneName(file.currentMilestone) === normalizedMilestone ? 1 : 0);
    }
    return (
      total +
      rawSupplyOrders(file).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          getEffectiveOrderCurrentMilestone(file, order) === normalizedMilestone,
      ).length
    );
  }, 0);
}

function countCompletedSupplyOrderMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (!shouldUseOrderMilestoneRows(file)) {
      return (
        total +
        (normalizeCompletedMilestones(file.completedMilestones).some(
          (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
        )
          ? 1
          : 0)
      );
    }
    return (
      total +
      rawSupplyOrders(file).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          normalizeCompletedMilestones(order.completedMilestones).some(
            (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
          ),
      ).length
    );
  }, 0);
}

function getMilestoneFlow(files: FileRecord[]) {
  const flow = milestoneDefinitions.map((milestone) => {
    const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
    const reachedFiles = applicableFiles.filter((file) => isEligibleMilestone(file, milestone));
    const activeFiles = applicableFiles.filter((file) => isManualActiveMilestone(file, milestone));
    const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
    const clearedFiles = applicableFiles.filter((file) => isMilestoneComplete(file, milestone));
    const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));

    if (milestone.key === "supplyOrder") {
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countEffectiveSupplyOrders(applicableFiles),
        underProcess: Math.max(0, applicableFiles.length - reachedFiles.length),
        active: activeFiles.length,
        pending: pendingFiles.length,
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countPlacedSupplyOrders(files),
        activeLabel: "In process",
        liveSupplyOrders: countLiveSupplyOrders(files),
      };
    }

    if (milestone.key === "bankGuarantee") {
      const eligibleBgFiles = applicableFiles.filter(isBankGuaranteeEligible);
      const activeBgFiles = eligibleBgFiles.filter((file) =>
        isManualActiveMilestone(file, milestone),
      );
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total files",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countBgApplicableOrders(files),
        underProcess: Math.max(
          0,
          applicableFiles.filter((file) => !isEligibleMilestone(file, milestone)).length,
        ),
        active: activeBgFiles.length,
        pending: countBgPendingOrders(files),
        reviewed: 0,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countBgReceivedOrders(files),
        bgToBeReturned: countBgToBeReturnedOrders(files),
        activeLabel: "In process",
      };
    }

    if (milestone.key === "payment") {
      const paymentCompleted = countPaymentCompletedOrders(files);
      const paymentPending = countPaymentPendingOrders(files);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: paymentCompleted + paymentPending,
        underProcess: Math.max(0, applicableFiles.length - reachedFiles.length),
        active: activeFiles.length,
        pending: paymentPending,
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: paymentCompleted,
        activeLabel: "In process",
      };
    }

    return {
      key: milestone.key,
      label: milestone.label,
      completedLabel: milestone.completedLabel ?? "Completed",
      totalLabel: milestone.totalLabel ?? "Total",
      pendingLabel: getMilestonePendingLabel(milestone),
      total: applicableFiles.length,
      underProcess: Math.max(0, applicableFiles.length - reachedFiles.length),
      active: activeFiles.length,
      pending: pendingFiles.length,
      reviewed: reviewedFiles.length,
      hasReviewed: Boolean(milestone.reviewed),
      cleared: clearedFiles.length,
      activeLabel: "In process",
      liveBids:
        milestone.key === "bidding" ? applicableFiles.filter(isFileTenderLive).length : undefined,
      overdueBids:
        milestone.key === "bidding" ? applicableFiles.filter(isBidOverdue).length : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? activeFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file)).length
          : undefined,
    };
  });
  const supplyOrderIndex = flow.findIndex((milestone) => milestone.key === "supplyOrder");
  const delivery = {
    key: "delivery",
    label: "Delivery",
    completed: countDeliveryCompletedOrders(files),
    due: countDeliveryPendingOrders(files),
    overdue: countDeliveryOverdueOrders(files),
  };
  const ir = {
    key: "ir",
    label: "IR",
    irPreparationPending: countIrPreparationPendingOrders(files),
    irReceiptPending: countIrReceiptPendingOrders(files),
    irCompleted: countIrCompletedOrders(files),
  };
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period / Milestone",
    valid: countDeliveryPeriodValidOrders(files),
    expired: countDeliveryPeriodExpiredOrders(files),
    extended: countDeliveryPeriodExtendedOrders(files),
  };
  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...flow, deliveryPeriod]
      : [
          ...flow.slice(0, supplyOrderIndex + 1),
          deliveryPeriod,
          ...flow.slice(supplyOrderIndex + 1),
        ];
  const paymentIndex = withDeliveryPeriod.findIndex((milestone) => milestone.key === "payment");
  if (paymentIndex === -1) return [...withDeliveryPeriod, delivery, ir];
  return [
    ...withDeliveryPeriod.slice(0, paymentIndex),
    delivery,
    ir,
    ...withDeliveryPeriod.slice(paymentIndex),
  ];
}

function getMilestonePendingLabel(milestone: (typeof milestoneDefinitions)[number]) {
  if (!("pendingLabel" in milestone)) return "Pending";
  return typeof milestone.pendingLabel === "string" ? milestone.pendingLabel : "Pending";
}

function getAnalyticsSummary(
  files: FileRecord[],
  divisions: Division[],
  valueThresholdLevels: AppSettings["valueThresholdLevels"] = [],
) {
  return {
    divisionFileRanking: getDivisionFileRanking(files),
    divisionValueRanking: getDivisionValueRanking(files, divisions),
    divisionTurnaroundRanking: getDivisionTurnaroundRanking(files),
    topFirmSupplyOrders: getTopFirmSupplyOrders(files),
    topIndentorsByFiles: getTopIndentorsByFiles(files),
    topIndentorsByValue: getTopIndentorsByValue(files),
    milestoneClearingRanking: getMilestoneClearingRanking(files),
    monthlyFileInflow: getMonthlyFileInflow(files),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files, valueThresholdLevels),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
  };
}

function getDivisionFileRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getDivisionValueRanking(files: FileRecord[], divisions: Division[]) {
  const totals = new Map<string, Record<string, number>>();
  const getCurrent = (name: string) =>
    totals.get(name) ?? {
      allocatedCapital: 0,
      allocatedRevenue: 0,
      intendedCapital: 0,
      intendedRevenue: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      committedCapital: 0,
      committedRevenue: 0,
    };
  divisions.forEach((division) => {
    const name = getAnalyticsName(division.name, "Unassigned");
    const current = getCurrent(name);
    totals.set(name, {
      ...current,
      allocatedCapital: current.allocatedCapital + (parseAmount(division.allocatedCapital) ?? 0),
      allocatedRevenue: current.allocatedRevenue + (parseAmount(division.allocatedRevenue) ?? 0),
    });
  });
  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    const current = getCurrent(name);
    const cancelled = isCancelledFile(file);
    const demandCapital = cancelled ? 0 : (getInrAmount(file.valueCapital, file) ?? 0);
    const demandRevenue = cancelled ? 0 : (getInrAmount(file.valueRevenue, file) ?? 0);
    const committedCapital = isSoCancelledFile(file) ? 0 : getFileCommittedCapitalValue(file);
    const committedRevenue = isSoCancelledFile(file) ? 0 : getFileCommittedRevenueValue(file);
    totals.set(name, {
      allocatedCapital: current.allocatedCapital,
      allocatedRevenue: current.allocatedRevenue,
      intendedCapital:
        current.intendedCapital + (!hasFilledField(file, "imms") ? demandCapital : 0),
      intendedRevenue:
        current.intendedRevenue + (!hasFilledField(file, "imms") ? demandRevenue : 0),
      bookedCapital:
        current.bookedCapital +
        (!cancelled && hasFilledField(file, "imms") && committedCapital <= 0 ? demandCapital : 0),
      bookedRevenue:
        current.bookedRevenue +
        (!cancelled && hasFilledField(file, "imms") && committedRevenue <= 0 ? demandRevenue : 0),
      committedCapital: current.committedCapital + committedCapital,
      committedRevenue: current.committedRevenue + committedRevenue,
    });
  });
  return Array.from(totals.entries())
    .map(([name, values]) => ({
      name,
      allocatedCapital: Math.round(values.allocatedCapital),
      allocatedRevenue: Math.round(values.allocatedRevenue),
      allocatedTotal: Math.round(values.allocatedCapital + values.allocatedRevenue),
      intendedCapital: Math.round(values.intendedCapital),
      intendedRevenue: Math.round(values.intendedRevenue),
      intendedTotal: Math.round(values.intendedCapital + values.intendedRevenue),
      bookedCapital: Math.round(values.bookedCapital),
      bookedRevenue: Math.round(values.bookedRevenue),
      bookedTotal: Math.round(values.bookedCapital + values.bookedRevenue),
      committedCapital: Math.round(values.committedCapital),
      committedRevenue: Math.round(values.committedRevenue),
      committedTotal: Math.round(values.committedCapital + values.committedRevenue),
    }))
    .sort(
      (a, b) => b.allocatedCapital + b.allocatedRevenue - (a.allocatedCapital + a.allocatedRevenue),
    );
}

function getDivisionTurnaroundRanking(files: FileRecord[]) {
  const durations = new Map<string, number[]>();
  files.forEach((file) => {
    const days = getDayDifference(file.receivedDate, getFirstSoDate(file));
    if (days === undefined || days < 0) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    durations.set(name, [...(durations.get(name) ?? []), days]);
  });
  return Array.from(durations.entries())
    .map(([name, values]) => ({
      name,
      averageDays: getRoundedAverage(values),
      sampleSize: values.length,
    }))
    .sort((a, b) => b.averageDays - a.averageDays);
}

function getTopFirmSupplyOrders(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    fileSupplyOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order)) return;
      const name = getAnalyticsName(order.firm, "Unassigned firm");
      const value = getSupplyOrderTotalValue(file, order);
      if (value <= 0) return;
      totals.set(name, (totals.get(name) ?? 0) + value);
    });
  });
  return mapEntriesToSortedRows(totals, "value");
}

function getSupplyOrderValueDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
) {
  const totals = new Map<string, number>();
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    const value = getSupplyOrderTotalValue(file, order);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configuredFirmTypes);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals);
}

function getActualPaymentDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
) {
  const totals = new Map<string, number>();
  effectivePaymentEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    const value =
      (getInrAmount(order.actualPaymentCapital, file) ?? 0) +
      (getInrAmount(order.actualPaymentRevenue, file) ?? 0);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configuredFirmTypes);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals);
}

function getTopIndentorsByFiles(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getTopIndentorsByValue(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    totals.set(name, (totals.get(name) ?? 0) + getFileTotalValue(file));
  });
  return mapEntriesToSortedRows(totals, "value");
}

function getMilestoneClearingRanking(files: FileRecord[]) {
  return milestoneClearingDefinitions
    .map((definition) => {
      const durations = files
        .filter((file) => definition.name !== "Delivery" || isDeliveryInspectionApplicable(file))
        .map((file) => getDayDifference(definition.getStartDate(file), definition.getEndDate(file)))
        .filter((days): days is number => days !== undefined && days >= 0);
      return {
        name: definition.name,
        averageDays: getRoundedAverage(durations),
        sampleSize: durations.length,
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((a, b) => b.averageDays - a.averageDays);
}

function getMonthlyFileInflow(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const month = getMonthKey(file.receivedDate ?? file.date);
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([name, count]) => ({ name, count }));
}

function getBiddingModeMix(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.mode?.trim().toUpperCase(), "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getFileValueThresholds(files: FileRecord[], levels: AppSettings["valueThresholdLevels"]) {
  if (!levels.length) return [];
  const rows = levels.map((level) => ({
    name: level.label,
    appliesTo: formatThresholdAppliesTo(level.appliesTo),
    range: formatThresholdRange(level),
    count: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  }));
  const unmatched = {
    name: "Unmatched",
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  };

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    const valueType = capital > 0 ? "capital" : revenue > 0 ? "revenue" : undefined;
    const amount = valueType === "capital" ? capital : valueType === "revenue" ? revenue : 0;
    if (!valueType || amount <= 0) return;
    const matchIndex = levels.findIndex((level) => isThresholdMatch(level, valueType, amount));
    const row = matchIndex >= 0 ? rows[matchIndex] : unmatched;
    row.count += 1;
    row.capital += capital;
    row.revenue += revenue;
    row.value += capital + revenue;
  });

  const roundedRows = rows.map(roundThresholdAnalyticsRow);
  return unmatched.count ? [...roundedRows, roundThresholdAnalyticsRow(unmatched)] : roundedRows;
}

function isThresholdMatch(
  level: AppSettings["valueThresholdLevels"][number],
  valueType: "capital" | "revenue",
  value: number,
) {
  if (level.appliesTo !== "both" && level.appliesTo !== valueType) return false;
  const min = parseAmount(level.minValue);
  const max = parseAmount(level.maxValue);
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function roundThresholdAnalyticsRow(row: {
  name: string;
  appliesTo: string;
  range: string;
  count: number;
  capital: number;
  revenue: number;
  value: number;
}) {
  return {
    ...row,
    capital: Math.round(row.capital),
    revenue: Math.round(row.revenue),
    value: Math.round(row.value),
  };
}

function formatThresholdAppliesTo(value: AppSettings["valueThresholdLevels"][number]["appliesTo"]) {
  if (value === "capital") return "Capital";
  if (value === "revenue") return "Revenue";
  return "Both";
}

function formatThresholdRange(level: AppSettings["valueThresholdLevels"][number]) {
  const min = parseAmount(level.minValue);
  const max = parseAmount(level.maxValue);
  if (min !== undefined && max !== undefined) {
    return `${formatLakhRangeAmount(min)}-${formatLakhRangeAmount(max)} L`;
  }
  if (min !== undefined) return `${formatLakhRangeAmount(min)} L+`;
  if (max !== undefined) return `0-${formatLakhRangeAmount(max)} L`;
  return "Any value";
}

function formatLakhRangeAmount(value: number) {
  const lakhs = value / 100000;
  return Number.isInteger(lakhs)
    ? String(lakhs)
    : lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function getDivisionRiskRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (!isRiskFile(file)) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getDivisionPaymentPendingRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (!isPaymentPending(file)) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function isRiskFile(file: FileRecord) {
  return (
    isDeliveryDue(file) ||
    isDeliveryPeriodExpired(file) ||
    isYes(file.demandCancelled) ||
    fileSupplyOrders(file).some((order) => isYes(order.ld) || isYes(order.soCancelled))
  );
}

const milestoneClearingDefinitions = [
  {
    name: "Scrutiny",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.scrutinyCompletionDate,
  },
  {
    name: "High Value",
    getStartDate: (file: FileRecord) => file.highValueMeetingDate,
    getEndDate: (file: FileRecord) => file.highValueMinutesDate,
  },
  {
    name: "Pre-TCEC",
    getStartDate: (file: FileRecord) => file.preTcecDate,
    getEndDate: (file: FileRecord) => file.preTcecMinutesDate,
  },
  {
    name: "AD",
    getStartDate: (file: FileRecord) => file.preTcecMinutesDate ?? file.receivedDate,
    getEndDate: (file: FileRecord) => file.adVettingDate,
  },
  {
    name: "R&QA",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.rqaApprovalDate,
  },
  {
    name: "Controlling",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.immsDate,
  },
  {
    name: "IFA",
    getStartDate: (file: FileRecord) => file.ifaSentDate,
    getEndDate: (file: FileRecord) => file.ifaFinalDate,
  },
  {
    name: "CFA",
    getStartDate: (file: FileRecord) => file.cfaSentDate,
    getEndDate: (file: FileRecord) => file.cfaDate,
  },
  {
    name: "Post-TCEC",
    getStartDate: (file: FileRecord) => file.postTcecDate,
    getEndDate: (file: FileRecord) => file.postTcecMinutesDate,
  },
  {
    name: "CNC",
    getStartDate: (file: FileRecord) => file.cncDate,
    getEndDate: (file: FileRecord) => file.cncApprovalDate,
  },
  {
    name: "Supply Order",
    getStartDate: (file: FileRecord) => file.cfaDate,
    getEndDate: getFirstSoDate,
  },
  {
    name: "Delivery",
    getStartDate: getFirstSoDate,
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "materialReceiptDate"),
  },
  {
    name: "Payment",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "materialReceiptDate"),
    getEndDate: getFirstPaymentDate,
  },
];

function fileSupplyOrders(file: FileRecord) {
  return normalizedFileSupplyOrders(file);
}

function rawSupplyOrders(file: FileRecord) {
  const rows = file.supplyOrders?.map((row) => ({ ...row })).filter(hasFilledObjectValue) ?? [];
  if (rows.length) return rows;
  const legacy: SupplyOrderDetail = {
    soDate: file.soDate,
    bgValidityDate: file.bgValidityDate,
    bgReturnDate: file.bgReturnDate,
    soCancelled: file.soCancelled,
  };
  return hasFilledObjectValue(legacy) ? [legacy] : [];
}

function rawSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => rawSupplyOrders(file).map((order) => ({ file, order })));
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
    if (!hasFilledString(text)) return false;
    return !isDefaultNoField(key, text);
  });
}

function isDefaultNoField(key: string, value: string) {
  return (
    value.toLowerCase() === "no" &&
    ["demandCancelled", "dpExtension", "ld", "soCancelled"].includes(key)
  );
}

function effectiveSupplyOrderEntries(files: FileRecord[]) {
  return normalizedSupplyOrderEntries(files);
}

function effectivePaymentEntries(files: FileRecord[]) {
  return normalizedPaymentEntries(files);
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isLegacySoCancelledFile(file) || isYes(order.soCancelled);
}

function countEffectiveSupplyOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).length;
}

function countPlacedSupplyOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(({ order }) => hasSupplyOrderDate(order)).length;
}

function countLiveSupplyOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      hasSupplyOrderDate(order) &&
      hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order) &&
      !isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countDeliveryOverdueOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countDeliveryPeriodValidOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isValidDeliveryPeriodEntry(file, order),
  ).length;
}

function countDeliveryPeriodExpiredOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isExpiredDeliveryPeriodEntry(file, order),
  ).length;
}

function countDeliveryPeriodExtendedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isExtendedDeliveryPeriodEntry(file, order),
  ).length;
}

function countBgApplicableOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) => isYes(file.bg) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgReceivedOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isYes(file.bg) &&
      hasFilledString(order.bgValidityDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgPendingOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isYes(file.bg) &&
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.bgValidityDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgToBeReturnedOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isYes(file.bg) &&
      hasSupplyOrderDate(order) &&
      hasFilledString(order.bgValidityDate) &&
      isDateBeforeToday(order.bgValidityDate) &&
      !hasFilledString(order.bgReturnDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countIrPreparationPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasSupplyOrderDate(order) &&
      hasFilledString(order.materialReceiptDate) &&
      !hasFilledString(order.irPreparationDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countIrReceiptPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasFilledString(order.irPreparationDate) &&
      !hasFilledString(order.irReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countIrCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasFilledString(order.irReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) => hasFilledString(order.paymentDate) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) =>
      hasPaymentWorkflowStarted(order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countLdOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ order }) => isYes(order.ld) && !isYes(order.soCancelled),
  ).length;
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? hasFilledString(value) : Boolean(value);
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
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

function getFileTotalValue(file: FileRecord) {
  return (
    (getInrAmount(file.valueCapital, file) ?? 0) + (getInrAmount(file.valueRevenue, file) ?? 0)
  );
}

function getFileCommittedCapitalValue(file: FileRecord) {
  const orders = fileSupplyOrders(file).filter((order) => !isYes(order.soCancelled));
  if (orders.length)
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0);
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const orders = fileSupplyOrders(file).filter((order) => !isYes(order.soCancelled));
  if (orders.length)
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueRevenue, file) ?? 0);
}

function getSupplyOrderTotalValue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(order.soValueCapital, file) ?? 0) +
    (getInrAmount(order.soValueRevenue, file) ?? 0)
  );
}

function mapEntriesToSortedRows<T extends "count" | "value">(values: Map<string, number>, key: T) {
  return Array.from(values.entries())
    .map(
      ([name, value]) =>
        ({ name, [key]: Math.round(value) }) as { name: string } & Record<T, number>,
    )
    .sort((a, b) => b[key] - a[key]);
}

function mapDistributionEntriesToRows(values: Map<string, number>) {
  const total = Array.from(values.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(values.entries())
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      share: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function getFirmTypeDistributionName(
  order: SupplyOrderDetail,
  configuredFirmTypes: string[] | undefined,
) {
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const raw = order.firmTypeOther?.trim() || order.firmType?.trim() || "";
  if (!raw) return "Unassigned firm type";
  const configuredMatch = configured.find(
    (firmType) => firmType.toLowerCase() === raw.toLowerCase(),
  );
  return configuredMatch ?? raw;
}

function getRoundedAverage(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getAnalyticsName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function getMonthKey(date: string | undefined) {
  if (!date || !hasDate(date)) return undefined;
  return date.slice(0, 7);
}

function getDayDifference(fromDate: string | undefined, toDate: string | undefined) {
  const fromTime = parseLocalDateTime(fromDate ?? "");
  const toTime = parseLocalDateTime(toDate ?? "");
  if (fromTime === undefined || toTime === undefined) return undefined;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function getFirstSoDate(file: FileRecord) {
  return getEarliestSupplyOrderDate(file, "soDate");
}

function getFirstPaymentDate(file: FileRecord) {
  return getEarliestSupplyOrderDate(file, "paymentDate");
}

function getEarliestSupplyOrderDate(file: FileRecord, key: keyof SupplyOrderDetail) {
  return fileSupplyOrders(file)
    .map((order) => String(order[key] ?? ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0];
}

function isPaymentPending(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return fileSupplyOrders(file).some(
    (order) => hasPaymentWorkflowStarted(order) && !hasFilledString(order.paymentDate),
  );
}

function hasPaymentWorkflowStarted(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.materialReceiptDate) ||
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate)
  );
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

function isEligibleMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
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
  return getMilestoneNameAliases(milestone).some(
    (name) => current === normalizeMilestoneName(name),
  );
}

function getMilestoneNameAliases(milestone: (typeof milestoneDefinitions)[number]) {
  return milestone.key === "control" ? [milestone.label, "Controlled"] : [milestone.label];
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  return supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)
    ? fileSupplyOrders(file).some((order) => {
        const value = order[key as keyof SupplyOrderDetail];
        return typeof value === "string" && hasFilledString(value);
      })
    : hasFilledField(file, key as keyof FileRecord);
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function isFileTenderLive(file: FileRecord) {
  return isYes(file.tenderLive);
}

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)
    ? file.refloatBidOpeningDate
    : file.bidOpeningDate;
}

function isBidOverdue(file: FileRecord) {
  return isNo(file.bidOpened) && isDateBeforeToday(getEffectiveBidOpeningDate(file));
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isDeliveryOverdue(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isOverdueDeliveryOrder);
}

function isDeliveryCompleted(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isPendingDeliveryOrder);
}

function isDeliveryActive(file: FileRecord) {
  return isDeliveryInspectionApplicable(file) && isSupplyOrderPlaced(file);
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  return fileType !== "amc" && fileType !== "mpc" && fileType !== "cars" && fileType !== "o&m";
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

function isPendingDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && !isDateBeforeToday(getDeliveryDueDate(order));
}

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function isOverdueDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateBeforeToday(getDeliveryDueDate(order));
}

function isDeliveryPeriodValid(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isValidDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isExpiredDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isExtendedDeliveryPeriodEntry(file, order))
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

function isBankGuaranteeEligible(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isYes(file.bg) &&
    rawSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isCancelledFile(file: FileRecord) {
  if (isYes(file.demandCancelled)) return true;
  const orders = rawSupplyOrders(file);
  if (orders.length === 0) return isYes(file.soCancelled);
  return orders.every((order) => isYes(order.soCancelled));
}

function isSoCancelledFile(file: FileRecord) {
  const orders = rawSupplyOrders(file);
  return isLegacySoCancelledFile(file) || (orders.length > 0 && orders.every((order) => isYes(order.soCancelled)));
}

function isLegacySoCancelledFile(file: FileRecord) {
  return isYes(file.soCancelled) && (file.supplyOrders?.length ?? 0) === 0;
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
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

function getPercent(value: number, total: number) {
  if (total <= 0) return undefined;
  return (value / total) * 100;
}
