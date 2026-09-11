import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchMasterFirms,
  store,
  type BillReturnCycle,
  type FileRecord,
  type FirmDetail,
  type MasterFirm,
  type SupplementaryBillDetail,
  type SupplyOrderDetail,
  type ValueThresholdLevel,
  useAccessibleDivisions,
  useSettings,
} from "@/lib/files-store";
import {
  isBiddingApplicableForFile,
  isContractFileType,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";
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
} from "@/lib/effective-deliveries";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  Filter,
  Lock,
  Unlock,
  Printer,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { DateInput, formatIsoDateForDisplay } from "@/components/date-input";
import { SearchableDropdown } from "@/components/searchable-dropdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { promptDeletionPassword } from "@/lib/delete-password";
import {
  downloadBackendExport,
  downloadBackendFileSearchExport,
  type FileSearchExportLayout,
  getExportFileName,
} from "@/lib/export-download";
import { formatThousandsAndLakhs, getInrAmount, parseAmount } from "@/lib/money";
import {
  getMilestoneValidationTarget,
  validateMilestoneCompletionConsistency,
} from "@/lib/milestone-validation";
import type { TableFieldPreset } from "@/lib/table-field-presets";
import {
  buildDemandProcessingRows,
  getDemandProcessingField,
} from "@/lib/demand-processing-analysis";
import { fileMatchesCategory, normalizeFileCategories } from "@/lib/file-categories";
import {
  getReturnedBillCashOutgoEventDate,
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
  normalizeBillReturnCycles,
} from "@/lib/refloat-returned-bill";
import { isCancelledFile } from "@/lib/year-filter";
import { filterControlClass, filterLabelClass } from "@/lib/active-filter-style";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => {
    const validated: {
      dashboardFilter?: string;
      extraDashboardFilters?: string;
      valueThresholdFilter?: string;
      soValueThresholdFilter?: string;
      division?: string;
      includeModes?: string;
      selectedYear?: string;
      fileYear?: string;
      fileInitiationFrom?: string;
      fileInitiationTo?: string;
      fileCategories?: string;
      analyticsType?: "firm" | "indentor";
      analyticsNames?: string;
      focusSection?: string;
      focusMilestone?: string;
      focusTarget?: string;
      focusTargets?: string;
      drillPath?: string;
    } = {};
    if (typeof search.dashboardFilter === "string")
      validated.dashboardFilter = search.dashboardFilter;
    if (typeof search.extraDashboardFilters === "string")
      validated.extraDashboardFilters = search.extraDashboardFilters;
    if (typeof search.valueThresholdFilter === "string")
      validated.valueThresholdFilter = search.valueThresholdFilter;
    if (typeof search.soValueThresholdFilter === "string")
      validated.soValueThresholdFilter = search.soValueThresholdFilter;
    if (typeof search.division === "string") validated.division = search.division;
    if (typeof search.includeModes === "string") validated.includeModes = search.includeModes;
    if (typeof search.selectedYear === "string") validated.selectedYear = search.selectedYear;
    if (typeof search.fileYear === "string") validated.fileYear = search.fileYear;
    if (typeof search.fileInitiationFrom === "string")
      validated.fileInitiationFrom = search.fileInitiationFrom;
    if (typeof search.fileInitiationTo === "string")
      validated.fileInitiationTo = search.fileInitiationTo;
    if (typeof search.fileCategories === "string") validated.fileCategories = search.fileCategories;
    if (search.analyticsType === "firm" || search.analyticsType === "indentor") {
      validated.analyticsType = search.analyticsType;
    }
    if (typeof search.analyticsNames === "string") validated.analyticsNames = search.analyticsNames;
    if (typeof search.focusSection === "string") validated.focusSection = search.focusSection;
    if (typeof search.focusMilestone === "string") validated.focusMilestone = search.focusMilestone;
    if (typeof search.focusTarget === "string") validated.focusTarget = search.focusTarget;
    if (typeof search.focusTargets === "string") validated.focusTargets = search.focusTargets;
    if (typeof search.drillPath === "string") validated.drillPath = search.drillPath;
    return validated;
  },
  component: SearchPage,
});

type FileKey = Exclude<
  keyof FileRecord,
  | "id"
  | "createdAt"
  | "bqFirms"
  | "invitedFirms"
  | "bidderFirms"
  | "supplyOrders"
  | "remarks"
  | "completedMilestones"
>;

type FieldDef = {
  key: TableFieldKey;
  label: string;
  type?: "date" | "number" | "textarea";
  options?: string[];
};

type DrillPathItem = { label: string; href?: string };
type ComplementaryPresenceMode = "none" | "filled" | "blank";

const tcecDisabledKeys: FileKey[] = [
  "highValueMeetingDate",
  "highValueMinutesDate",
  "preTcecDate",
  "preTcecMinutesDate",
  "preTcecCommitteeNo",
  "ad",
  "adVettingDate",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "cncDate",
  "cncApprovalDate",
];

const gemDisabledKeys: FileKey[] = ["gemUndertakingDate", "gemSoNo"];
const rfpVettingDisabledKeys: FileKey[] = ["rfpVettingInitiationDate", "rfpVettingApprovalDate"];
const highValueDisabledKeys: FileKey[] = ["highValueMeetingDate", "highValueMinutesDate"];
const rqaDisabledKeys: FileKey[] = ["rqaApprovalDate"];
const ifaDisabledKeys: FileKey[] = ["ifaSentDate", "ifaFinalDate"];
const bgDisabledKeys: FileKey[] = [];
const irDisabledKeys: FileKey[] = ["irPreparationDate", "irReceiptDate"];
const preBidMeetingDisabledKeys: FileKey[] = ["preBidMeetingDate"];
const refloatDisabledKeys: FileKey[] = [
  "refloatPreBidMeeting",
  "refloatPreBidMeetingDate",
  "refloatBiddingDate",
  "refloatBidOpeningDate",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
];
const refloatPreBidMeetingDisabledKeys: FileKey[] = ["refloatPreBidMeetingDate"];
const biddingStageOverDisabledKeys: FileKey[] = [
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "cncDate",
  "cncApprovalDate",
];
const tcecCommitteeKeys: FileKey[] = [
  "preTcecCommitteeNo",
  "postTcecCommitteeNumber",
  "refloatPostTcecCommitteeNo",
];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const gemBiddingModeOptions = ["Custom", "Catalogue", "Comparison"];
const defaultFileTypeOptions = ["Goods & Services", "AMC", "MPC", "CARS", "O&M"];
const defaultModeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const defaultFirmTypes = ["MSE", "MSE (Women)", "Non-MSE"];
const firmSearchScopeOptions = [
  { key: "bq", label: "BQ" },
  { key: "invited", label: "Invited" },
  { key: "bidder", label: "Bidders" },
  { key: "so", label: "S.O." },
];
const defaultFirmSearchScopes = firmSearchScopeOptions.map((option) => option.key);
const paymentModeOptions = ["Online", "Offline"];
const searchFilterHelpers = {
  freeSearch: [
    "Searches broadly across file text fields.",
    "Use structured filters when you need exact year, date, value, firm, or status logic.",
  ],
  filters: [
    "Search results may already include filters received from Dashboard or Reports.",
    "Reset filters clears manual filters and dashboard landing context.",
    "Clicker results may focus a row or section inside each file.",
    "The top Flip and Filled/Blank controls are complementary controls.",
    "They become active only after you select compatible filters from the normal filter panel.",
    "They do not add a separate field selector; they work on the filters already selected.",
    "When more than one compatible filter is selected, the complementary condition is applied to all selected compatible filters using AND logic.",
    "Mixed selections are allowed: Flip applies only to selected Yes/No filters, while Filled/Blank applies only to SELECTED DATE OR VALUE FILTERS.",
  ],
  yesNoComplement: [
    "Flip works on selected Yes/No filters such as TCEC, CNC, IFA, High Value, AD, R&QA, Warranty, Refloat, RST, stage delivery, stage payment, and similar flags.",
    "When Flip is unchecked, selected Yes/No filters keep their normal meaning: Yes.",
    "When Flip is checked, selected Yes/No filters are reversed to No.",
    "If multiple Yes/No filters are selected, Flip applies to all of them using AND logic.",
    "Example: TCEC checked alone means TCEC Yes; TCEC checked with Flip means TCEC No.",
    "Example: TCEC + CNC with Flip means TCEC No and CNC No.",
  ],
  filledBlankComplement: [
    "This option works on SELECTED DATE OR VALUE FILTERS such as CNC date, IFA final date, Payment date, S.O. date, D.P. period, BG dates, demand value, and S.O. value.",
    "Select normal date/value filters first; then choose Filled or Blank from this top control.",
    "If multiple date/value filters are selected, all selected filter fields must satisfy the selected condition.",
    "For grouped filters, Filled means any related date/value in that group is filled; Blank means all related dates/values in that group are blank.",
    "Example: Payment date + Blank checks payment-related dates such as main payment, advance payment, and supplementary payment as a group.",
  ],
  year: [
    "Searches the file's own initiation year.",
    "This is different from the main/global Activity Year.",
    "Use this only when you want files started in a particular FY.",
  ],
  fileType: [
    "Filters by the file type saved in File Details.",
    "Multiple checked file types work as OR, so a file matching any checked type is shown.",
  ],
  indentor: [
    "Filters by indentor name recorded in the file.",
    "Use this when you want files raised by a specific indentor.",
  ],
  division: [
    "Filters by the division recorded in the file.",
    "Your user access can still limit which divisions are visible.",
  ],
  value: [
    "Filters by demand value entered in the file.",
    "Default is All value bands.",
    "Configured value bands use the same thresholds as Dashboard analytics.",
    "Capital/Revenue checkboxes restrict which demand value side is considered.",
    "This is not S.O. value.",
  ],
  soValue: [
    "Filters by supply order value recorded inside the file.",
    "Default is All S.O. value bands.",
    "Configured S.O. value bands use the same thresholds as Dashboard analytics.",
    "One file may have multiple S.O. rows.",
    "Capital/Revenue checkboxes restrict which S.O. value side is considered.",
  ],
  paymentCriteria: [
    "These are row/workflow based filters.",
    "One file may match because of one S.O., stage payment, advance payment, or LD row.",
    "Actual payment made includes main S.O./stage/advance actual amounts and supplementary actual amounts.",
    "A file can match more than one payment condition.",
  ],
  description: [
    "Searches the demand description text recorded in File Details.",
    "Use broad free search if you want to search across many text fields together.",
  ],
  firmType: [
    "Filters by firm type recorded against S.O. firm details.",
    "Firm type other is used only when the S.O. firm type is Other.",
    "Multiple checked firm types work as OR, so a file matching any checked type is shown.",
  ],
  supplyOrderPresence: [
    "Only shows files where at least one Supply Order exists.",
    "Exclude shows files where no Supply Order exists.",
    "None means this condition is not applied.",
  ],
  biddingMode: [
    "Only restricts results to one selected bidding mode.",
    "Only one Only option can be active in this group.",
    "Multiple Exclude options can be active together.",
  ],
  gemBiddingMode: [
    "Only restricts results to one selected GeM bidding mode.",
    "Multiple Exclude options can be active together.",
    "GeM mode filters apply to files marked as GeM where relevant.",
  ],
  workflowFlags: [
    "Filters by specific workflow flags or milestones recorded in a file.",
    "Checked filters work as additional conditions and can narrow results strongly.",
    "IFA and CNC use Only/Exclude/None because absence can also be meaningful.",
  ],
  demandControlDates: [
    "These filters use the specific demand/control date field selected.",
    "Demand receipt and demand control may give different results for the same file.",
  ],
  approvalDates: [
    "These filters use the selected approval or committee date field.",
    "Pre-TCEC remains separate from Post-TCEC.",
    "Post-TCEC date, minutes, and committee include normal Post-TCEC and Refloat Post-TCEC.",
    "Pre-Bid and bidding filters include normal and refloat cycle dates.",
    "Other dates are checked separately, such as TCEC minutes, IFA final, CFA approval, or CNC date.",
    "Closure and cancellation visibility follows the selected Global filter unless a closure/cancellation three-way filter is used.",
  ],
  supplyDeliveryDates: [
    "These filters use the specific supply order or delivery date field selected.",
    "S.O. date, D.P. period, and material receipt date may give different results for the same file.",
  ],
  bgPaymentClosureDates: [
    "Bill sent/submitted includes main bills, returned-bill resubmissions, stage/advance rows, and supplementary bills.",
    "Payment date includes main, stage, advance, and supplementary payment dates.",
    "BG dates and file closure date remain separate activity dates.",
    "Selecting one does not automatically filter by the others.",
  ],
  dpPeriod: [
    "Filters by delivery period date or revised delivery period where applicable.",
    "This is different from actual material receipt or job completion.",
  ],
  tcecCommittee: [
    "Filters by the selected TCEC committee number.",
    "Use with the corresponding TCEC date filter when both committee and date matter.",
  ],
  firm: [
    "Firm search can look in BQ, invited, bidder, and S.O. firm records depending on selected checkboxes.",
    "Firm search is treated as firm history, so it can include File Closed, Cancelled demand, cancelled S.O., and shortclosed S.O. records.",
    "Firm name and Unique No. if selected together may match different firm entries inside the same file.",
  ],
  freeDate: [
    "Searches for this date across many date fields.",
    "Use specific date filters when you need exact field-level matching.",
  ],
  tableFields: [
    "Controls which columns are visible in results and export.",
    "It does not change which files are returned.",
  ],
  requiredFields: [
    "Checking a column header means show only files where this field is filled.",
    "It filters results; it is different from merely showing or hiding columns.",
  ],
  closureAndCancellation: [
    "File Closed, Cancelled demand, Cancelled S.O., and Shortclosed S.O. can be filtered as Only, Exclude, or None.",
    "Only returns files having that condition.",
    "Only for closure or cancellation history can bypass the Global filter's active-file restriction so those files are not hidden just because the Global filter is Active files.",
    "Exclude removes files having that condition.",
    "None does not apply that condition and leaves normal Global filter behavior unchanged.",
  ],
  specialFileMarker: [
    "Filters by special marker codes linked to files.",
    "Selecting multiple markers shows files having any selected marker.",
    "If no file has the selected marker, the result list should be empty.",
  ],
} satisfies Record<string, string[]>;
type SearchHelperExamples = {
  title: string;
  items: string[];
};
const searchFilterExamples: Record<string, SearchHelperExamples> = {
  "Value help": {
    title: "Value examples",
    items: [
      "Demand value 8 lakh: the file appears in the matching demand value band.",
      "Capital checked only: only demand capital value is considered.",
      "Revenue checked only: only demand revenue value is considered.",
      "Capital and Revenue checked together: either side can make the file match.",
      "This filter does not check S.O. value.",
    ],
  },
  "S.O. Value help": {
    title: "S.O. value examples",
    items: [
      "One file has S.O.s of 6 lakh and 35 lakh: the file can match either selected S.O. value band.",
      "S.O. value is checked order by order, not by adding all S.O.s in the file.",
      "Capital checked only: only S.O. capital value is considered.",
      "Revenue checked only: only S.O. revenue value is considered.",
      "A zero S.O. value is not treated as a useful value-band match.",
    ],
  },
  "Payment criteria help": {
    title: "Payment examples",
    items: [
      "Main bill payment pending: a file can match because final Payment Date is blank.",
      "Stage payment pending: a file can match because a stage payment row is incomplete.",
      "Advance payment pending: a file can match because an advance payment row is incomplete.",
      "Returned bill pending: a file can match because returned bill resubmission/payment is still open.",
      "One file may match more than one payment condition.",
    ],
  },
  "Approval Dates help": {
    title: "Approval date examples",
    items: [
      "Pre-TCEC date filter checks Pre-TCEC date only; Post-TCEC is not mixed into it.",
      "Post-TCEC date filter checks normal Post-TCEC and Refloat Post-TCEC date.",
      "Pre-Bid date filter checks normal Pre-Bid and Refloat Pre-Bid date where applicable.",
      "CNC date filter checks CNC Date; CNC Approval Date must be filtered separately.",
      "Active files selected: File Closed, Demand Cancelled, and all-S.O.-cancelled files are normally hidden.",
      "All files selected: those inactive files can appear if their selected approval/date field matches.",
      "A file can match a date range because of one relevant date even if other approval dates are blank.",
    ],
  },
  "BG, Payment & Closure Dates help": {
    title: "BG/payment date examples",
    items: [
      "Payment date filter can match main, stage, advance, or supplementary payment dates.",
      "Bill sent/submitted date can match original bill submission or returned-bill resubmission.",
      "BG receipt date does not automatically mean BG return date is filled.",
      "File Closure Date is separate from payment date and BG return date.",
      "Use specific date fields when you need exact activity-date matching.",
    ],
  },
  "D.P. period help": {
    title: "D.P. examples",
    items: [
      "Original D.P. within range: the file can match even if revised D.P. is blank.",
      "Revised D.P. within range: the file can match through the revised date where applicable.",
      "D.P. expired means the D.P. date has passed; it does not by itself prove delivery/job completion.",
      "Material Receipt Date and Job Completion Date are separate filters.",
    ],
  },
  "Firm help": {
    title: "Firm examples",
    items: [
      "BQ selected: firm is searched in BQ firm rows.",
      "Invited selected: firm is searched in invited firm rows.",
      "Bidders selected: firm is searched in bidder rows.",
      "S.O. selected: firm is searched in S.O. firm rows, including cancelled or shortclosed S.O. history where applicable.",
      "Firm name and Unique No. may match different firm rows inside the same file.",
    ],
  },
  "Closure & cancellation help": {
    title: "Closure examples",
    items: [
      "File Closed set to Only: closed files can appear even if Global filter is Active files.",
      "Cancelled S.O. set to Only: files with cancelled S.O. history can appear even if active-file filtering would normally hide them.",
      "Shortclosed S.O. set to Only: files having shortclosed S.O.s are shown.",
      "Cancelled demand set to Exclude: demand-cancelled files are removed from results.",
      "All options set to None: normal Global filter behavior remains unchanged.",
    ],
  },
  "Flip help": {
    title: "Flip examples",
    items: [
      "Select TCEC with Flip unchecked: shows TCEC Yes files, as before.",
      "Select TCEC with Flip checked: shows TCEC No files.",
      "Select TCEC and CNC with Flip checked: shows files where both TCEC and CNC are No.",
      "Select IFA with Flip checked: shows files where IFA is No.",
      "If no Yes/No filter is selected, Flip remains disabled.",
    ],
  },
  "Filled/Blank complementary help": {
    title: "Filled/Blank examples",
    items: [
      "Select CNC date, then set Filled/Blank to Blank: shows files where CNC date is blank.",
      "Select CNC approval date through CNC filter context, then set Blank: helps identify CNC cases pending approval date.",
      "Select Payment date, then set Blank: shows files where the payment-related date group is still blank.",
      "Select demand value, then set Filled: shows files where demand value is entered.",
      "If no date or value filter is selected, this control remains disabled.",
    ],
  },
};
const defaultMilestones = [
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
  "Refloat bidding",
  "Refloat Post-TCEC",
  "CNC",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "Job Completion",
  "Bill sent for payment",
  "Bill returned for correction",
  "Payment",
  "File Closed",
];
const fileClosedMilestone = "File Closed";
type IncludeExcludeFilter = "none" | "include" | "exclude";
function parseSearchListParam(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function includeOnlyFilterState(values: string[]) {
  return values.reduce<Record<string, IncludeExcludeFilter>>((current, value) => {
    current[value] = "include";
    return current;
  }, {});
}

function getValueThresholdFilterLabel(value: string, levels: ValueThresholdLevel[]) {
  if (!value || value === "all") return "All value bands";
  if (value === "valueThreshold:Unmatched") return "Unmatched";
  if (value.startsWith("valueThresholdRange:")) {
    const [, rawMin = "", rawMax = "", rawAppliesTo = "both"] = value.split(":");
    const level: ValueThresholdLevel = {
      label: "",
      levelNumber: 0,
      minValue: decodeURIComponent(rawMin),
      maxValue: decodeURIComponent(rawMax),
      appliesTo: rawAppliesTo === "capital" || rawAppliesTo === "revenue" ? rawAppliesTo : "both",
    };
    return formatValueThresholdOption(level);
  }
  if (value.startsWith("valueThresholdId:")) {
    const id = value.slice("valueThresholdId:".length);
    const level = levels.find((item) => item.id === id);
    return level ? formatValueThresholdOption(level) : "Selected value band";
  }
  if (value.startsWith("valueThreshold:")) {
    const { label, metric } = parseValueThresholdDashboardFilter(value, "valueThreshold:");
    return metric ? `${label} (${formatValueThresholdMetric(metric)})` : label;
  }
  return value;
}

function parseValueThresholdDashboardFilter(value: string, prefix: string) {
  const parts = value.slice(prefix.length).split(":");
  const rawMetric = parts.length > 1 ? decodeURIComponent(parts[parts.length - 1]) : "";
  const metric =
    rawMetric === "capital" || rawMetric === "revenue" || rawMetric === "total"
      ? rawMetric
      : undefined;
  if (metric) parts.pop();
  return {
    label: decodeURIComponent(parts.join(":")).trim(),
    metric,
  };
}

function formatValueThresholdMetric(metric: string) {
  if (metric === "capital") return "Capital";
  if (metric === "revenue") return "Revenue";
  return "Total";
}

function formatValueThresholdOption(level: ValueThresholdLevel) {
  const range = formatValueThresholdRange(level);
  if (level.appliesTo === "capital") return `${range} (Capital)`;
  if (level.appliesTo === "revenue") return `${range} (Revenue)`;
  return range;
}

function getValueThresholdFilterValue(level: ValueThresholdLevel) {
  return [
    "valueThresholdRange",
    encodeURIComponent(level.minValue ?? ""),
    encodeURIComponent(level.maxValue ?? ""),
    encodeURIComponent(level.appliesTo ?? "both"),
  ].join(":");
}

function getSoValueThresholdFilterValue(level: ValueThresholdLevel) {
  const min = parseAmount(level.minValue);
  return [
    "valueThresholdRange",
    encodeURIComponent(min === 0 ? "1" : (level.minValue ?? "")),
    encodeURIComponent(level.maxValue ?? ""),
    encodeURIComponent(level.appliesTo ?? "both"),
  ].join(":");
}

function formatValueThresholdRange(level: ValueThresholdLevel) {
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

const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Advance Payment",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "Job Completion",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Bill returned for correction",
  "Payment",
];
const delayStatusMilestoneLabels: Record<string, string> = {
  bidding: "Bidding Delay",
  financialSanction: "Financial Sanction",
  supplyOrder: "Supply Order",
  psb: "PSB",
  pwb: "PWB",
  psbPwb: "PSB+PWB",
  delivery: "Delivery",
  jobCompletion: "Job Completion",
  irPreparation: "IR Preparation",
  irReceipt: "IR Receipt",
  billPreparation: "Bill preparation",
  billSentForPayment: "Bill sent for payment",
  billReturnedForCorrection: "Bill returned for correction",
  supplementaryBillReturnedForCorrection: "Supplementary bill returned for correction",
  payment: "Payment",
};
const biddingDelayMilestoneKey = "bidding";
const supplementaryBillReturnedDelayMilestoneKey = "supplementaryBillReturnedForCorrection";
const defaultNoKeys: FileKey[] = [
  "dpExtension",
  "gte",
  "rfpVetting",
  "preBidMeeting",
  "tenderLive",
  "refloat",
  "refloatPreBidMeeting",
  "rst",
  "biddingStageOver",
  "demandCancelled",
  "soCancelled",
];
type SortDirection = "asc" | "desc";
type SupplyOrderKey =
  | "financialSanctionDate"
  | "psbApplicable"
  | "bgCoverageType"
  | "psbBgNo"
  | "psbBgAmount"
  | "psbBgReceivedDate"
  | "psbBgValidityDate"
  | "psbBgReturnDate"
  | "pwbBgNo"
  | "pwbBgAmount"
  | "pwbBgReceivedDate"
  | "pwbBgValidityDate"
  | "pwbBgReturnDate"
  | "combinedBgNo"
  | "combinedBgAmount"
  | "combinedBgReceivedDate"
  | "combinedBgValidityDate"
  | "combinedBgReturnDate"
  | "warrantyPeriodDate"
  | "soNo"
  | "gemSoNo"
  | "soDate"
  | "soValueCapital"
  | "soValueRevenue"
  | "billAmountCapital"
  | "billAmountRevenue"
  | "dpDate"
  | "firm"
  | "firmUniqueNo"
  | "firmType"
  | "firmTypeOther"
  | "dpExtension"
  | "dpExtensionCount"
  | "ld"
  | "ldType"
  | "ldPercentage"
  | "revisedDp"
  | "materialReceiptDate"
  | "jobCompletionDate"
  | "irPreparationDate"
  | "irReceiptDate"
  | "billPreparationDate"
  | "billNo"
  | "billSentForPaymentDate"
  | "billReturnCycles"
  | "paymentDate"
  | "paymentMode"
  | "actualPaymentCapital"
  | "actualPaymentRevenue"
  | "supplementaryBills"
  | "supplementaryBillNo"
  | "supplementaryBillAmountCapital"
  | "supplementaryBillAmountRevenue"
  | "supplementaryBillSentForPaymentDate"
  | "supplementaryBillReturnCycles"
  | "supplementaryBillPaymentDate"
  | "supplementaryBillPaymentMode"
  | "supplementaryBillActualPaymentCapital"
  | "supplementaryBillActualPaymentRevenue"
  | "supplementaryBillRemarks"
  | "soCancelled"
  | "soCancelledDate"
  | "deliveryPeriodStartDate"
  | "stageDelivery"
  | "stageDeliveryCount"
  | "stageDeliveryLabel"
  | "stageAmountCapital"
  | "stageAmountRevenue"
  | "stagePayment"
  | "advancePayment"
  | "advanceStageAmountCapital"
  | "advanceStageAmountRevenue"
  | "advancePaymentDate"
  | "advanceActualPaymentCapital"
  | "advanceActualPaymentRevenue";
type FirmDetailTableFieldKey =
  | "bqFirmNames"
  | "bqFirmUniqueNos"
  | "invitedFirmNames"
  | "invitedFirmUniqueNos"
  | "bidderFirmNames"
  | "bidderFirmUniqueNos";
const firmDetailTableFieldKeys = new Set<string>([
  "bqFirmNames",
  "bqFirmUniqueNos",
  "invitedFirmNames",
  "invitedFirmUniqueNos",
  "bidderFirmNames",
  "bidderFirmUniqueNos",
]);
type CustomTableFieldKey = "soCurrentMilestone" | FirmDetailTableFieldKey;
type TableFieldKey = FileKey | SupplyOrderKey | CustomTableFieldKey;
const supplyOrderKeys: SupplyOrderKey[] = [
  "financialSanctionDate",
  "soNo",
  "gemSoNo",
  "soDate",
  "soValueCapital",
  "soValueRevenue",
  "firm",
  "firmUniqueNo",
  "firmType",
  "firmTypeOther",
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
  "deliveryPeriodStartDate",
  "dpDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "ldType",
  "ldPercentage",
  "revisedDp",
  "materialReceiptDate",
  "jobCompletionDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billNo",
  "billSentForPaymentDate",
  "billReturnCycles",
  "paymentDate",
  "paymentMode",
  "actualPaymentCapital",
  "actualPaymentRevenue",
  "supplementaryBills",
  "supplementaryBillNo",
  "supplementaryBillAmountCapital",
  "supplementaryBillAmountRevenue",
  "supplementaryBillSentForPaymentDate",
  "supplementaryBillReturnCycles",
  "supplementaryBillPaymentDate",
  "supplementaryBillPaymentMode",
  "supplementaryBillActualPaymentCapital",
  "supplementaryBillActualPaymentRevenue",
  "supplementaryBillRemarks",
  "soCancelled",
  "soCancelledDate",
  "shortclosure",
  "shortclosureDate",
  "stageDelivery",
  "stageDeliveryCount",
  "stageDeliveryLabel",
  "stageAmountCapital",
  "stageAmountRevenue",
  "stagePayment",
  "advancePayment",
  "advanceStageAmountCapital",
  "advanceStageAmountRevenue",
  "advancePaymentDate",
  "advanceActualPaymentCapital",
  "advanceActualPaymentRevenue",
];

function isSupplyOrderKey(key: string): key is SupplyOrderKey {
  return supplyOrderKeys.includes(key as SupplyOrderKey);
}

function isCustomTableFieldKey(key: string): key is CustomTableFieldKey {
  return key === "soCurrentMilestone" || isFirmDetailTableFieldKey(key);
}

const fieldSections: { title: string; fields: FieldDef[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "division", label: "Division" },
      { key: "year", label: "Year" },
      { key: "activeYears", label: "Active years" },
      { key: "uniqueCode", label: "Unique code" },
      { key: "receivedDate", label: "Demand received date", type: "date" },
      { key: "imms", label: "Control number" },
      { key: "immsDate", label: "Control date", type: "date" },
      { key: "fileNo", label: "File no" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Demand description", type: "textarea" },
      { key: "valueCapital", label: "Value (Capital)" },
      { key: "valueRevenue", label: "Value (Revenue)" },
      { key: "currency", label: "Currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number" },
      { key: "gte", label: "GTE", options: yesNo },
      { key: "fileType", label: "File Type", options: defaultFileTypeOptions },
      { key: "mode", label: "Mode", options: defaultModeOptions },
      { key: "tcec", label: "TCEC (Yes/No)", options: yesNoCaps },
      { key: "gem", label: "GeM (Yes/No)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "bg", label: "Warranty (Yes/No)", options: yesNo },
      { key: "ir", label: "IR (Yes/No)", options: yesNo },
      { key: "rfpVetting", label: "RFP vetting", options: yesNo },
      { key: "currentMilestone", label: "Current milestone" },
      { key: "fileClosureDate", label: "File Closure Date", type: "date" },
      { key: "demandCancelled", label: "Demand cancelled (Yes/No)", options: yesNo },
      { key: "demandCancelledDate", label: "Demand cancelled date", type: "date" },
    ],
  },
  {
    title: "Scrutiny and control",
    fields: [
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response date", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
    ],
  },
  {
    title: "TCEC block",
    fields: [
      { key: "preTcecCommitteeNo", label: "Pre-TCEC committee" },
      { key: "preTcecDate", label: "Pre-TCEC date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post-TCEC committee" },
      { key: "postTcecDate", label: "Post-TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post-TCEC minutes date", type: "date" },
      { key: "refloatPostTcecCommitteeNo", label: "Refloat Post-TCEC committee" },
      { key: "refloatPostTcecDate", label: "Refloat Post-TCEC date", type: "date" },
      {
        key: "refloatPostTcecMinutesDate",
        label: "Refloat Post-TCEC minutes date",
        type: "date",
      },
    ],
  },
  {
    title: "Approval block",
    fields: [
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaSentDate", label: "CFA sent date", type: "date" },
      { key: "cfaDate", label: "CFA approval date", type: "date" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemBiddingMode", label: "GeM Bidding Mode", options: gemBiddingModeOptions },
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "preBidMeeting", label: "Pre-Bid Meeting (Yes/No)", options: yesNo },
      { key: "preBidMeetingDate", label: "Pre-Bid Meeting date", type: "date" },
      { key: "tenderLive", label: "Tender Live (Yes/No)", options: yesNo },
      { key: "bidNumber", label: "Bid number" },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid closing date", type: "date" },
      { key: "bidOpened", label: "Bid opened (Yes/No)", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatPreBidMeeting", label: "Refloat Pre-Bid Meeting (Yes/No)", options: yesNo },
      { key: "refloatPreBidMeetingDate", label: "Refloat Pre-Bid Meeting date", type: "date" },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat bid closing date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "biddingStageOver", label: "Bidding stage over", options: yesNo },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "noOfSo", label: "No. of S.O.", type: "number" },
      { key: "soCurrentMilestone", label: "S.O. current milestone" },
      { key: "financialSanctionDate", label: "Financial Sanction date", type: "date" },
      { key: "soNo", label: "S.O. No." },
      { key: "gemSoNo", label: "GeM S.O. No." },
      { key: "soDate", label: "S.O. date", type: "date" },
      { key: "soValueCapital", label: "S.O. value (Capital)" },
      { key: "soValueRevenue", label: "S.O. value (Revenue)" },
      { key: "billAmountCapital", label: "Bill amount (Capital)" },
      { key: "billAmountRevenue", label: "Bill amount (Revenue)" },
      { key: "firm", label: "S.O. Firm" },
      { key: "firmUniqueNo", label: "S.O. Firm Unique No." },
      { key: "firmType", label: "Firm type" },
      { key: "firmTypeOther", label: "Firm type other" },
      { key: "psbApplicable", label: "PSB applicable", options: yesNo },
      { key: "bgCoverageType", label: "BG coverage type" },
      { key: "psbBgNo", label: "PSB BG No." },
      { key: "psbBgAmount", label: "PSB BG amount" },
      { key: "psbBgReceivedDate", label: "PSB BG received date", type: "date" },
      { key: "psbBgValidityDate", label: "PSB BG validity date", type: "date" },
      { key: "psbBgReturnDate", label: "PSB BG return date", type: "date" },
      { key: "pwbBgNo", label: "PWB BG No." },
      { key: "pwbBgAmount", label: "PWB BG amount" },
      { key: "pwbBgReceivedDate", label: "PWB BG received date", type: "date" },
      { key: "pwbBgValidityDate", label: "PWB BG validity date", type: "date" },
      { key: "pwbBgReturnDate", label: "PWB BG return date", type: "date" },
      { key: "combinedBgNo", label: "PSB+PWB BG No." },
      { key: "combinedBgAmount", label: "PSB+PWB BG amount" },
      { key: "combinedBgReceivedDate", label: "PSB+PWB BG received date", type: "date" },
      { key: "combinedBgValidityDate", label: "PSB+PWB BG validity date", type: "date" },
      { key: "combinedBgReturnDate", label: "PSB+PWB BG return date", type: "date" },
      { key: "warrantyPeriodDate", label: "Warranty period", type: "date" },
      { key: "deliveryPeriodStartDate", label: "Delivery period start date", type: "date" },
      { key: "dpDate", label: "D.P. date", type: "date" },
      { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
      { key: "dpExtensionCount", label: "Extension count", type: "number" },
      { key: "ld", label: "LD", options: yesNo },
      { key: "ldType", label: "LD type", options: ["Full", "Partial"] },
      { key: "ldPercentage", label: "LD percentage", type: "number" },
      { key: "revisedDp", label: "Revised D.P.", type: "date" },
      { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
      { key: "jobCompletionDate", label: "Job Completion Date", type: "date" },
      { key: "irPreparationDate", label: "IR Preparation", type: "date" },
      { key: "irReceiptDate", label: "IR Receipt", type: "date" },
      { key: "billPreparationDate", label: "Bill preparation", type: "date" },
      { key: "billNo", label: "Bill No." },
      { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
      { key: "billReturnCycles", label: "Bill returned for correction" },
      { key: "paymentDate", label: "Payment date", type: "date" },
      { key: "paymentMode", label: "Payment mode (Online/Offline)", options: paymentModeOptions },
      { key: "actualPaymentCapital", label: "Actual payment amount (Capital)" },
      { key: "actualPaymentRevenue", label: "Actual payment amount (Revenue)" },
      { key: "supplementaryBills", label: "Supplementary bills" },
      { key: "supplementaryBillNo", label: "Supplementary Bill No." },
      { key: "supplementaryBillAmountCapital", label: "Supplementary bill amount (Capital)" },
      { key: "supplementaryBillAmountRevenue", label: "Supplementary bill amount (Revenue)" },
      {
        key: "supplementaryBillSentForPaymentDate",
        label: "Supplementary bill sent for payment",
      },
      { key: "supplementaryBillReturnCycles", label: "Supplementary bill returned for correction" },
      { key: "supplementaryBillPaymentDate", label: "Supplementary payment date" },
      { key: "supplementaryBillPaymentMode", label: "Supplementary payment mode" },
      {
        key: "supplementaryBillActualPaymentCapital",
        label: "Supplementary actual payment amount (Capital)",
      },
      {
        key: "supplementaryBillActualPaymentRevenue",
        label: "Supplementary actual payment amount (Revenue)",
      },
      { key: "supplementaryBillRemarks", label: "Supplementary bill remarks" },
      { key: "shortclosure", label: "Shortclosure (Yes/No)", options: yesNo },
      { key: "shortclosureDate", label: "Shortclosure date", type: "date" },
      { key: "soCancelled", label: "S.O. cancelled (Yes/No)", options: yesNo },
      { key: "soCancelledDate", label: "S.O. cancelled date", type: "date" },
      { key: "stageDelivery", label: "Stage delivery", options: yesNo },
      { key: "stageDeliveryCount", label: "No. of stage deliveries", type: "number" },
      { key: "stageDeliveryLabel", label: "Stage delivery label" },
      { key: "stageAmountCapital", label: "Stage amount (Capital)" },
      { key: "stageAmountRevenue", label: "Stage amount (Revenue)" },
      { key: "stagePayment", label: "Stage payment", options: yesNo },
      { key: "advancePayment", label: "Advance payment", options: yesNo },
      { key: "advanceStageAmountCapital", label: "Advance stage amount (Capital)" },
      { key: "advanceStageAmountRevenue", label: "Advance stage amount (Revenue)" },
      { key: "advancePaymentDate", label: "Advance payment date", type: "date" },
      { key: "advanceActualPaymentCapital", label: "Advance actual payment capital" },
      { key: "advanceActualPaymentRevenue", label: "Advance actual payment revenue" },
    ],
  },
];

const editableFields = fieldSections.flatMap((section) => section.fields);
const editableFileFields = editableFields.filter(
  (field): field is FieldDef & { key: FileKey } =>
    !isSupplyOrderKey(field.key) && !isCustomTableFieldKey(field.key),
);
type ComplementaryFieldSelection = {
  key: string;
  label: string;
  group?: string[];
};

function formatComplementaryFieldList(fields: ComplementaryFieldSelection[]) {
  if (!fields.length) return "No compatible selected filter";
  if (fields.length <= 2) return fields.map((field) => field.label).join(", ");
  return `${fields
    .slice(0, 2)
    .map((field) => field.label)
    .join(", ")} +${fields.length - 2}`;
}

function encodeComplementaryFieldGroups(fields: ComplementaryFieldSelection[]) {
  return fields
    .map((field) => (field.group?.length ? field.group : [field.key]).join("|"))
    .join(",");
}

function hasDateRangeFilter(from: string, to: string) {
  return Boolean(from || to);
}

type PrintColumn = {
  key: string;
  label: string;
  getValue: (file: FileRecord) => string;
};
type SearchExportTable = {
  headers: string[];
  rows: Array<Array<string | number>>;
};

const firmDetailFieldLabels: Record<FirmDetailTableFieldKey, string> = {
  bqFirmNames: "BQ firm names",
  bqFirmUniqueNos: "BQ firm unique nos.",
  invitedFirmNames: "Invited firm names",
  invitedFirmUniqueNos: "Invited firm unique nos.",
  bidderFirmNames: "Bidder firm names",
  bidderFirmUniqueNos: "Bidder firm unique nos.",
};

const firmDetailColumns: PrintColumn[] = [
  {
    key: "bqBasis",
    label: "BQ basis",
    getValue: (file: FileRecord) => file.bqBasis ?? "",
  },
  ...(Object.entries(firmDetailFieldLabels) as Array<[FirmDetailTableFieldKey, string]>).map(
    ([key, label]) => ({
      key,
      label,
      getValue: (file: FileRecord) => getFirmDetailTableValue(file, key),
    }),
  ),
];

const sortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const printColumns: PrintColumn[] = [
  ...editableFields.map((field) => ({
    key: field.key,
    label: field.label,
    getValue: (file: FileRecord) => {
      const value = getPrintColumnValue(file, field.key);
      return field.type === "date" ? formatIsoDateForDisplay(value) : value;
    },
  })),
  ...firmDetailColumns,
];

function getPrintColumnValue(file: FileRecord, key: TableFieldKey) {
  if (key === "noOfSo") return getNoOfSo(file);
  if (key === "soCurrentMilestone") return getSupplyOrderCurrentMilestoneValue(file);
  if (key === "demandDescription") return getDescriptionWithUniqueCode(file);
  if (isFirmDetailTableFieldKey(key)) return getFirmDetailTableValue(file, key);
  if (isSupplyOrderKey(key)) return getSupplyOrderFieldValue(file, key);
  if (key === "valueCapital" || key === "valueRevenue") return getFileAmountFieldValue(file, key);
  return String(file[key] ?? "");
}

function getDescriptionWithUniqueCode(file: FileRecord) {
  const uniqueCode = (file.uniqueCode ?? "").trim();
  const description = (file.demandDescription ?? "").trim();
  if (uniqueCode && description) return `${uniqueCode} — ${description}`;
  return description || uniqueCode;
}

function isFirmDetailTableFieldKey(key: string): key is FirmDetailTableFieldKey {
  return firmDetailTableFieldKeys.has(key);
}

function getFirmDetailTableValue(file: FileRecord, key: FirmDetailTableFieldKey) {
  if (!isBiddingApplicableForFile(file)) return "";
  const rows = key.startsWith("bq")
    ? file.bqFirms
    : key.startsWith("invited")
      ? file.invitedFirms
      : file.bidderFirms;
  const valueKey = firmDetailValueKey(key);
  return (rows ?? [])
    .map((firm, index, allRows) => {
      const value = String(firm[valueKey] ?? "").trim();
      if (!value) return "";
      return allRows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("\n");
}

function firmDetailValueKey(key: FirmDetailTableFieldKey): keyof FirmDetail {
  if (key.endsWith("Names")) return "firmName";
  if (key.endsWith("UniqueNos")) return "firmUniqueNo";
  if (key.endsWith("Emails")) return "emailId";
  if (key.endsWith("Cities")) return "city";
  return "contactNo";
}

const printColumnGroups = [
  ...fieldSections.map((section) => ({
    title: section.title,
    columns: section.fields
      .map((field) => printColumns.find((column) => column.key === field.key))
      .filter((column): column is PrintColumn => Boolean(column)),
  })),
  {
    title: "Firm details",
    columns: firmDetailColumns,
  },
].filter((group) => group.columns.length > 0);

const allTableColumnKeys = printColumns.map((column) => column.key);
const manualTablePresetId = "manual";
const searchPageSizeOptions = [10, 25, 50];

const stagedSupplyOrderExportKeys = new Set<string>([
  "currentMilestone",
  "deliveryPeriodStartDate",
  "dpDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "stageDeliveryLabel",
  "stageAmountCapital",
  "stageAmountRevenue",
  "materialReceiptDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billNo",
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "actualPaymentCapital",
  "actualPaymentRevenue",
]);
const stagedDeliveryWorkflowKeys = new Set<string>([
  "currentMilestone",
  "deliveryPeriodStartDate",
  "dpDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "stageDeliveryLabel",
  "stageAmountCapital",
  "stageAmountRevenue",
  "materialReceiptDate",
  "jobCompletionDate",
  "irPreparationDate",
  "irReceiptDate",
]);
const stagedPaymentWorkflowKeys = new Set<string>([
  "billPreparationDate",
  "billNo",
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "actualPaymentCapital",
  "actualPaymentRevenue",
]);
const supplementaryBillTableKeys = new Set<string>([
  "supplementaryBills",
  "supplementaryBillNo",
  "supplementaryBillAmountCapital",
  "supplementaryBillAmountRevenue",
  "supplementaryBillSentForPaymentDate",
  "supplementaryBillReturnCycles",
  "supplementaryBillPaymentDate",
  "supplementaryBillPaymentMode",
  "supplementaryBillActualPaymentCapital",
  "supplementaryBillActualPaymentRevenue",
  "supplementaryBillRemarks",
]);
const TABLE_FIELDS_DEFAULT_KEY_PREFIX = "ofms.searchTableDefaultFields.v2";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

function tableDefaultStorageKey(userId: string | undefined) {
  return `${TABLE_FIELDS_DEFAULT_KEY_PREFIX}.${userId || "no-active-user"}`;
}

function readDefaultTableColumnKeys(userId: string | undefined) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(tableDefaultStorageKey(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return null;
    const validKeys = new Set(printColumns.map((column) => column.key));
    const filtered = saved.filter(
      (key): key is string => typeof key === "string" && validKeys.has(key),
    );
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

function getValidTableColumnKeys(keys: string[]) {
  const validKeys = new Set(printColumns.map((column) => column.key));
  return keys.filter((key) => validKeys.has(key));
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function appendSearchParam(params: URLSearchParams, key: string, value: string | undefined) {
  if (value?.trim()) params.set(key, value.trim());
}

function appendSearchBool(params: URLSearchParams, key: string, value: boolean) {
  if (value) params.set(key, "true");
}

function appendIncludeExcludeParam(
  params: URLSearchParams,
  key: string,
  value: IncludeExcludeFilter,
) {
  if (value !== "none") params.set(key, value);
}

function appendSearchList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length) params.set(key, values.join(","));
}

function addFilterChipIf(chips: string[], active: boolean, label: string, value?: string) {
  if (!active) return;
  const cleanValue = value?.trim();
  chips.push(cleanValue ? `${label}: ${cleanValue}` : label);
}

function parseDrillPath(value: string | undefined): DrillPathItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string") return { label: item.trim() };
        if (!item || typeof item !== "object") return undefined;
        const label = typeof item.label === "string" ? item.label.trim() : "";
        const href = typeof item.href === "string" ? item.href.trim() : "";
        return label ? { label, href: href || undefined } : undefined;
      })
      .filter((item): item is DrillPathItem => Boolean(item))
      .slice(0, 12);
  } catch {
    return value
      .split(">")
      .map((item) => ({ label: item.trim() }))
      .filter((item) => item.label)
      .slice(0, 12);
  }
}

function serializeDrillPath(items: DrillPathItem[]) {
  const cleanItems = items
    .map((item) => ({ label: item.label.trim(), href: item.href?.trim() || undefined }))
    .filter((item) => item.label);
  return cleanItems.length ? JSON.stringify(cleanItems) : undefined;
}

function getCurrentHref() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.pathname}${window.location.search}`;
}

function uniqueSortedOptions(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

async function fetchBackendSearchResults(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/files/search${query ? `?${query}` : ""}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Search request failed: ${response.status}`);
  }
  return (await response.json()) as {
    files: FileRecord[];
    total: number;
    summaryTotals?: Record<string, number>;
    page: number;
    pageSize: number;
  };
}

function SearchPage() {
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const drillPath = useMemo(() => parseDrillPath(search.drillPath), [search.drillPath]);
  const currentSearchHref = getCurrentHref();
  const divisionOptions = divisions.map((division) => division.name);
  const years = useMemo(
    () => Array.from(new Set(settings.financialYears.filter(Boolean))).sort(),
    [settings.financialYears],
  );
  const firmTypeOptions = useMemo(
    () => getConfiguredFirmTypes(settings.firmTypes),
    [settings.firmTypes],
  );

  const [yearFilter, setYearFilter] = useState("");
  const [indentor, setIndentor] = useState("");
  const [divisionFilter, setDivisionFilter] = useState(search.division ?? "");
  const [valueThresholdFilter, setValueThresholdFilter] = useState(
    search.valueThresholdFilter ?? "all",
  );
  const [soValueThresholdFilter, setSoValueThresholdFilter] = useState(
    search.soValueThresholdFilter ?? "all",
  );
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
  const [soValueFrom, setSoValueFrom] = useState("");
  const [soValueTo, setSoValueTo] = useState("");
  const [soCapitalOnly, setSoCapitalOnly] = useState(false);
  const [soRevenueOnly, setSoRevenueOnly] = useState(false);
  const [capitalOnly, setCapitalOnly] = useState(false);
  const [revenueOnly, setRevenueOnly] = useState(false);
  const [description, setDescription] = useState("");
  const [firm, setFirm] = useState("");
  const [firmUniqueNo, setFirmUniqueNo] = useState("");
  const [firmContactNo, setFirmContactNo] = useState("");
  const [firmCity, setFirmCity] = useState("");
  const [firmSearchScopes, setFirmSearchScopes] = useState<string[]>(defaultFirmSearchScopes);
  const [masterFirms, setMasterFirms] = useState<MasterFirm[]>([]);
  const [modeFilters, setModeFilters] = useState<Record<string, IncludeExcludeFilter>>(() =>
    includeOnlyFilterState(parseSearchListParam(search.includeModes)),
  );
  const [gemModeFilters, setGemModeFilters] = useState<Record<string, IncludeExcludeFilter>>({});
  useEffect(() => {
    setModeFilters(includeOnlyFilterState(parseSearchListParam(search.includeModes)));
  }, [search.includeModes]);
  useEffect(() => {
    setValueThresholdFilter(search.valueThresholdFilter ?? "all");
  }, [search.valueThresholdFilter]);
  useEffect(() => {
    setSoValueThresholdFilter(search.soValueThresholdFilter ?? "all");
  }, [search.soValueThresholdFilter]);
  useEffect(() => {
    setModeFilters((current) => normalizeSingleOnlyMultiExcludeFilters(current));
  }, [modeFilters]);
  useEffect(() => {
    setGemModeFilters((current) => normalizeSingleOnlyMultiExcludeFilters(current));
  }, [gemModeFilters]);
  const selectedModes = useMemo(
    () =>
      Object.entries(modeFilters)
        .filter(([, value]) => value !== "none")
        .map(([mode]) => mode),
    [modeFilters],
  );
  const selectedGemBiddingModes = useMemo(
    () =>
      Object.entries(gemModeFilters)
        .filter(([, value]) => value !== "none")
        .map(([mode]) => mode),
    [gemModeFilters],
  );
  const [soPresenceFilter, setSoPresenceFilter] = useState<IncludeExcludeFilter>("none");
  const [selectedFirmTypes, setSelectedFirmTypes] = useState<string[]>([]);
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([]);
  const [specialFileMarkers, setSpecialFileMarkers] = useState<string[]>([]);
  const modeFilterOptions = useMemo(
    () => getConfiguredModes(settings.modes, selectedModes),
    [selectedModes, settings.modes],
  );
  const includeModeFilters = selectedModes.filter((mode) => modeFilters[mode] === "include");
  const excludeModeFilters = selectedModes.filter((mode) => modeFilters[mode] === "exclude");
  const includeGemModeFilters = selectedGemBiddingModes.filter(
    (mode) => gemModeFilters[mode] === "include",
  );
  const excludeGemModeFilters = selectedGemBiddingModes.filter(
    (mode) => gemModeFilters[mode] === "exclude",
  );
  const [advancePaymentFilter, setAdvancePaymentFilter] = useState(false);
  const [actualPaymentFilter, setActualPaymentFilter] = useState(false);
  const [stageDeliveryFilter, setStageDeliveryFilter] = useState(false);
  const [stagePaymentFilter, setStagePaymentFilter] = useState(false);
  const [dpExtensionFilter, setDpExtensionFilter] = useState(false);
  const [ldFilter, setLdFilter] = useState(false);
  const [highValue, setHighValue] = useState(false);
  const [gte, setGte] = useState(false);
  const [ad, setAd] = useState(false);
  const [rqa, setRqa] = useState(false);
  const [ifaPresenceFilter, setIfaPresenceFilter] = useState<IncludeExcludeFilter>("none");
  const [psbFilter, setPsbFilter] = useState(false);
  const [pwbFilter, setPwbFilter] = useState(false);
  const [psbPwbFilter, setPsbPwbFilter] = useState(false);
  const [bgFilter, setBgFilter] = useState(false);
  const [rfpVettingFilter, setRfpVettingFilter] = useState(false);
  const [refloat, setRefloat] = useState(false);
  const [cncPresenceFilter, setCncPresenceFilter] = useState<IncludeExcludeFilter>("none");
  const [tcec, setTcec] = useState(false);
  const [preBidMeetingFilter, setPreBidMeetingFilter] = useState(false);
  const [preTcecCommittee, setPreTcecCommittee] = useState("");
  const [postTcecCommittee, setPostTcecCommittee] = useState("");
  const [dpFrom, setDpFrom] = useState("");
  const [dpTo, setDpTo] = useState("");
  const [demandReceiptFrom, setDemandReceiptFrom] = useState("");
  const [demandReceiptTo, setDemandReceiptTo] = useState("");
  const [demandControlFrom, setDemandControlFrom] = useState("");
  const [demandControlTo, setDemandControlTo] = useState("");
  const [highValueMinutesFrom, setHighValueMinutesFrom] = useState("");
  const [highValueMinutesTo, setHighValueMinutesTo] = useState("");
  const [preTcecDateFrom, setPreTcecDateFrom] = useState("");
  const [preTcecDateTo, setPreTcecDateTo] = useState("");
  const [preTcecMinutesFrom, setPreTcecMinutesFrom] = useState("");
  const [preTcecMinutesTo, setPreTcecMinutesTo] = useState("");
  const [rqaApprovalFrom, setRqaApprovalFrom] = useState("");
  const [rqaApprovalTo, setRqaApprovalTo] = useState("");
  const [ifaFinalFrom, setIfaFinalFrom] = useState("");
  const [ifaFinalTo, setIfaFinalTo] = useState("");
  const [cfaApprovalFrom, setCfaApprovalFrom] = useState("");
  const [cfaApprovalTo, setCfaApprovalTo] = useState("");
  const [postTcecDateFrom, setPostTcecDateFrom] = useState("");
  const [postTcecDateTo, setPostTcecDateTo] = useState("");
  const [postTcecMinutesFrom, setPostTcecMinutesFrom] = useState("");
  const [postTcecMinutesTo, setPostTcecMinutesTo] = useState("");
  const [cncDateFrom, setCncDateFrom] = useState("");
  const [cncDateTo, setCncDateTo] = useState("");
  const [preBidDateFrom, setPreBidDateFrom] = useState("");
  const [preBidDateTo, setPreBidDateTo] = useState("");
  const [biddingDateFrom, setBiddingDateFrom] = useState("");
  const [biddingDateTo, setBiddingDateTo] = useState("");
  const [bidOpeningDateFrom, setBidOpeningDateFrom] = useState("");
  const [bidOpeningDateTo, setBidOpeningDateTo] = useState("");
  const [billSubmittedFrom, setBillSubmittedFrom] = useState("");
  const [billSubmittedTo, setBillSubmittedTo] = useState("");
  const [financialSanctionFrom, setFinancialSanctionFrom] = useState("");
  const [financialSanctionTo, setFinancialSanctionTo] = useState("");
  const [soDateFrom, setSoDateFrom] = useState("");
  const [soDateTo, setSoDateTo] = useState("");
  const [materialReceiptFrom, setMaterialReceiptFrom] = useState("");
  const [materialReceiptTo, setMaterialReceiptTo] = useState("");
  const [paymentDateFrom, setPaymentDateFrom] = useState("");
  const [paymentDateTo, setPaymentDateTo] = useState("");
  const [bgReceivedFrom, setBgReceivedFrom] = useState("");
  const [bgReceivedTo, setBgReceivedTo] = useState("");
  const [bgValidityFrom, setBgValidityFrom] = useState("");
  const [bgValidityTo, setBgValidityTo] = useState("");
  const [bgReturnFrom, setBgReturnFrom] = useState("");
  const [bgReturnTo, setBgReturnTo] = useState("");
  const [fileClosureFrom, setFileClosureFrom] = useState("");
  const [fileClosureTo, setFileClosureTo] = useState("");
  const [flipYesNoFilters, setFlipYesNoFilters] = useState(false);
  const [complementaryPresenceMode, setComplementaryPresenceMode] =
    useState<ComplementaryPresenceMode>("none");
  const [fileClosedPresenceFilter, setFileClosedPresenceFilter] =
    useState<IncludeExcludeFilter>("none");
  const [rstFilter, setRstFilter] = useState(false);
  const [demandCancelledPresenceFilter, setDemandCancelledPresenceFilter] =
    useState<IncludeExcludeFilter>("none");
  const [soCancelledPresenceFilter, setSoCancelledPresenceFilter] =
    useState<IncludeExcludeFilter>("none");
  const [shortclosedSoPresenceFilter, setShortclosedSoPresenceFilter] =
    useState<IncludeExcludeFilter>("none");
  const [freeText, setFreeText] = useState("");
  const [freeDate, setFreeDate] = useState("");
  const [sortColumnKey, setSortColumnKey] = useState("none");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [divisionWiseSort, setDivisionWiseSort] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showTableOptions, setShowTableOptions] = useState(false);
  const [activeTablePresetId, setActiveTablePresetId] = useState(manualTablePresetId);
  const [defaultTableColumnKeys, setDefaultTableColumnKeys] = useState<string[] | null>(() =>
    readDefaultTableColumnKeys(settings.activeUserId),
  );
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [expandedSearchFileIds, setExpandedSearchFileIds] = useState<Set<string>>(() => new Set());
  const [requiredFilledColumnKeys, setRequiredFilledColumnKeys] = useState<string[]>([]);
  const destinationFocus = useMemo(() => {
    const explicitFocus = getDestinationFocus(
      search.dashboardFilter,
      search.focusSection,
      search.focusMilestone,
      search.focusTarget,
    );
    if (
      search.dashboardFilter ||
      search.focusSection ||
      search.focusMilestone ||
      search.focusTarget
    ) {
      return explicitFocus;
    }
    return getSearchCheckboxDestinationFocus({
      advancePaymentFilter,
      actualPaymentFilter,
      stageDeliveryFilter,
      stagePaymentFilter,
      dpExtensionFilter,
      ldFilter,
    });
  }, [
    advancePaymentFilter,
    actualPaymentFilter,
    dpExtensionFilter,
    ldFilter,
    search.dashboardFilter,
    search.focusMilestone,
    search.focusSection,
    search.focusTarget,
    stageDeliveryFilter,
    stagePaymentFilter,
  ]);
  const destinationFocusTargets = useMemo(
    () => parseDestinationFocusTargets(search.focusTargets),
    [search.focusTargets],
  );
  const [backendResults, setBackendResults] = useState<FileRecord[]>([]);
  const [searchSummaryTotals, setSearchSummaryTotals] = useState<Record<string, number>>({});
  const [summaryTotalsExpanded, setSummaryTotalsExpanded] = useState(false);
  const [summaryTotalsLockedOpen, setSummaryTotalsLockedOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fileSearchSummaryTotalsLockedOpen") === "true";
  });
  const [searchTotal, setSearchTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasLoadedSearchResults, setHasLoadedSearchResults] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>();
  const hasLoadedSearchResultsRef = useRef(false);
  const [selectedTableColumnKeys, setSelectedTableColumnKeys] = useState<string[]>(
    () => defaultTableColumnKeys ?? allTableColumnKeys,
  );
  const tableFieldPresetSignature = JSON.stringify(settings.tableFieldPresets ?? []);
  const tableFieldPresets = useMemo(() => {
    try {
      return JSON.parse(tableFieldPresetSignature) as TableFieldPreset[];
    } catch {
      return [];
    }
  }, [tableFieldPresetSignature]);
  const selectedTablePreset = tableFieldPresets.find((preset) => preset.id === activeTablePresetId);
  const manualTableFieldsSelected = activeTablePresetId === manualTablePresetId;
  const tableDefaultChanged =
    selectedTableColumnKeys.length > 0 &&
    !isSearchDirtyValueEqual(selectedTableColumnKeys, defaultTableColumnKeys ?? []);
  const selectedTableColumns = useMemo(
    () => printColumns.filter((column) => selectedTableColumnKeys.includes(column.key)),
    [selectedTableColumnKeys],
  );
  const searchDisplayColumns = useMemo(
    () => buildSearchDisplayColumns(selectedTableColumns),
    [selectedTableColumns],
  );
  const summaryTotalsOpen = summaryTotalsLockedOpen || summaryTotalsExpanded;
  const toggleSummaryTotalsLockedOpen = () => {
    setSummaryTotalsLockedOpen((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("fileSearchSummaryTotalsLockedOpen", String(next));
      }
      if (next) setSummaryTotalsExpanded(true);
      return next;
    });
  };
  const visibleRequiredFilledColumnKeys = useMemo(
    () =>
      requiredFilledColumnKeys.filter((key) =>
        selectedTableColumns.some((column) => column.key === key),
      ),
    [requiredFilledColumnKeys, selectedTableColumns],
  );
  const visibleRequiredFilledColumnSignature = visibleRequiredFilledColumnKeys.join(",");
  const sortColumns = selectedTableColumns;
  const activeSortColumnKey = sortColumns.some((column) => column.key === sortColumnKey)
    ? sortColumnKey
    : "none";
  const toggleSearchFileExpansion = (fileId: string) => {
    setExpandedSearchFileIds((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };
  const expandAllVisibleSearchRows = () => {
    setExpandedSearchFileIds((current) => {
      const next = new Set(current);
      visibleExpandableFileIds.forEach((fileId) => next.add(fileId));
      return next;
    });
  };
  const collapseAllVisibleSearchRows = () => {
    setExpandedSearchFileIds((current) => {
      const next = new Set(current);
      visibleExpandableFileIds.forEach((fileId) => next.delete(fileId));
      return next;
    });
  };
  const openTimeline = (file: FileRecord) => {
    const nextDrillPath = currentSearchHref
      ? serializeDrillPath([...drillPath, { label: "Search Files", href: currentSearchHref }])
      : search.drillPath;
    const fileFocusTarget = file.id ? destinationFocusTargets.get(file.id) : undefined;
    const dashboardFileFocusTarget = getDashboardFilterFileFocusTarget(
      file,
      search.dashboardFilter,
    );
    const checkboxFileFocusTarget = getSearchCheckboxFileFocusTarget(file, {
      actualPaymentFilter,
    });
    navigate({
      to: "/add",
      search: {
        fileId: file.id,
        section: destinationFocus.section,
        milestone: destinationFocus.milestone,
        focusTarget:
          fileFocusTarget ??
          dashboardFileFocusTarget ??
          checkboxFileFocusTarget ??
          destinationFocus.focusTarget,
        quickFocus: false,
        drillPath: nextDrillPath,
      },
    });
  };

  useEffect(() => {
    setSelectedFirmTypes((current) =>
      current.filter((firmType) =>
        firmTypeOptions.some((option) => option.toLowerCase() === firmType.toLowerCase()),
      ),
    );
  }, [firmTypeOptions]);

  useEffect(() => {
    const userDefault = readDefaultTableColumnKeys(settings.activeUserId);
    setDefaultTableColumnKeys(userDefault);
    if (activeTablePresetId === manualTablePresetId) {
      setSelectedTableColumnKeys(userDefault ?? allTableColumnKeys);
    }
  }, [activeTablePresetId, settings.activeUserId]);

  useEffect(() => {
    if (activeTablePresetId === manualTablePresetId) return;
    const preset = tableFieldPresets.find((item) => item.id === activeTablePresetId);
    if (!preset) {
      setActiveTablePresetId(manualTablePresetId);
      setSelectedTableColumnKeys(defaultTableColumnKeys ?? allTableColumnKeys);
      return;
    }
    const nextKeys = getValidTableColumnKeys(preset.fieldKeys);
    setSelectedTableColumnKeys((current) =>
      sameStringList(current, nextKeys) ? current : nextKeys,
    );
  }, [activeTablePresetId, defaultTableColumnKeys, tableFieldPresets]);

  useEffect(() => {
    if (search.division) setDivisionFilter(search.division);
  }, [search.division]);

  useEffect(() => {
    fetchMasterFirms({ pageSize: 500 })
      .then((result) => setMasterFirms(result.firms))
      .catch((error) => console.error(error));
  }, []);

  const firmNameOptions = useMemo(
    () => uniqueSortedOptions(masterFirms.map((item) => item.firmName)),
    [masterFirms],
  );
  const firmUniqueNoOptions = useMemo(
    () => uniqueSortedOptions(masterFirms.map((item) => item.firmUniqueNo)),
    [masterFirms],
  );
  const firmContactNoOptions = useMemo(
    () => uniqueSortedOptions(masterFirms.map((item) => item.contactNo)),
    [masterFirms],
  );
  const firmCityOptions = useMemo(
    () => uniqueSortedOptions(masterFirms.map((item) => item.city)),
    [masterFirms],
  );
  const preTcecCommitteeOptions = useMemo(
    () => getTcecCommitteeOptions(settings.tcecCommittees, preTcecCommittee),
    [preTcecCommittee, settings.tcecCommittees],
  );
  const postTcecCommitteeOptions = useMemo(
    () => getTcecCommitteeOptions(settings.tcecCommittees, postTcecCommittee),
    [postTcecCommittee, settings.tcecCommittees],
  );
  const selectedComplementaryYesNoFields: ComplementaryFieldSelection[] = [
    advancePaymentFilter ? { key: "advancePayment", label: "Advance payment" } : undefined,
    stageDeliveryFilter ? { key: "stageDelivery", label: "Stage delivery" } : undefined,
    stagePaymentFilter ? { key: "stagePayment", label: "Stage payment" } : undefined,
    dpExtensionFilter ? { key: "dpExtension", label: "DP extension" } : undefined,
    ldFilter ? { key: "ld", label: "LD" } : undefined,
    highValue ? { key: "highValue", label: "High Value" } : undefined,
    gte ? { key: "gte", label: "GTE" } : undefined,
    ad ? { key: "ad", label: "AD" } : undefined,
    rqa ? { key: "rqa", label: "R&QA" } : undefined,
    ifaPresenceFilter !== "none" ? { key: "ifa", label: "IFA" } : undefined,
    bgFilter ? { key: "bg", label: "Warranty" } : undefined,
    rfpVettingFilter ? { key: "rfpVetting", label: "RFP vetting" } : undefined,
    refloat ? { key: "refloat", label: "Refloat" } : undefined,
    cncPresenceFilter !== "none" ? { key: "cnc", label: "CNC" } : undefined,
    tcec ? { key: "tcec", label: "TCEC" } : undefined,
    preBidMeetingFilter ? { key: "preBidMeeting", label: "Pre-Bid" } : undefined,
    rstFilter ? { key: "rst", label: "RST" } : undefined,
    demandCancelledPresenceFilter !== "none"
      ? { key: "demandCancelled", label: "Cancelled demand" }
      : undefined,
    soCancelledPresenceFilter !== "none"
      ? { key: "soCancelled", label: "Cancelled S.O." }
      : undefined,
    shortclosedSoPresenceFilter !== "none"
      ? { key: "shortclosure", label: "Shortclosed S.O." }
      : undefined,
  ].filter((field): field is ComplementaryFieldSelection => Boolean(field));
  const selectedComplementaryPresenceFields: ComplementaryFieldSelection[] = [
    valueFrom || valueTo
      ? {
          key: "valueCapital",
          label: "Demand value",
          group:
            capitalOnly && !revenueOnly
              ? ["valueCapital"]
              : revenueOnly && !capitalOnly
                ? ["valueRevenue"]
                : ["valueCapital", "valueRevenue"],
        }
      : undefined,
    soValueFrom || soValueTo
      ? {
          key: "soValueCapital",
          label: "S.O. value",
          group:
            soCapitalOnly && !soRevenueOnly
              ? ["soValueCapital"]
              : soRevenueOnly && !soCapitalOnly
                ? ["soValueRevenue"]
                : ["soValueCapital", "soValueRevenue"],
        }
      : undefined,
    cncPresenceFilter !== "none"
      ? { key: "cncApprovalDate", label: "CNC approval date" }
      : undefined,
    highValue ? { key: "highValueMinutesDate", label: "High Value minutes date" } : undefined,
    ad ? { key: "adVettingDate", label: "AD vetting date" } : undefined,
    rqa ? { key: "rqaApprovalDate", label: "R&QA approval date" } : undefined,
    ifaPresenceFilter !== "none" ? { key: "ifaFinalDate", label: "IFA final date" } : undefined,
    tcec ? { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date" } : undefined,
    hasDateRangeFilter(demandReceiptFrom, demandReceiptTo)
      ? { key: "receivedDate", label: "Demand receipt date" }
      : undefined,
    hasDateRangeFilter(demandControlFrom, demandControlTo)
      ? { key: "immsDate", label: "Demand control date" }
      : undefined,
    hasDateRangeFilter(highValueMinutesFrom, highValueMinutesTo)
      ? { key: "highValueMinutesDate", label: "High Value minutes date" }
      : undefined,
    hasDateRangeFilter(preTcecDateFrom, preTcecDateTo)
      ? { key: "preTcecDate", label: "Pre-TCEC date" }
      : undefined,
    hasDateRangeFilter(preTcecMinutesFrom, preTcecMinutesTo)
      ? { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date" }
      : undefined,
    hasDateRangeFilter(rqaApprovalFrom, rqaApprovalTo)
      ? { key: "rqaApprovalDate", label: "R&QA approval date" }
      : undefined,
    hasDateRangeFilter(ifaFinalFrom, ifaFinalTo)
      ? { key: "ifaFinalDate", label: "IFA final date" }
      : undefined,
    hasDateRangeFilter(cfaApprovalFrom, cfaApprovalTo)
      ? { key: "cfaDate", label: "CFA approval date" }
      : undefined,
    hasDateRangeFilter(postTcecDateFrom, postTcecDateTo)
      ? {
          key: "postTcecDate",
          label: "Post-TCEC date",
          group: ["postTcecDate", "refloatPostTcecDate"],
        }
      : undefined,
    hasDateRangeFilter(postTcecMinutesFrom, postTcecMinutesTo)
      ? {
          key: "postTcecMinutesDate",
          label: "Post-TCEC minutes date",
          group: ["postTcecMinutesDate", "refloatPostTcecMinutesDate"],
        }
      : undefined,
    hasDateRangeFilter(cncDateFrom, cncDateTo) ? { key: "cncDate", label: "CNC date" } : undefined,
    hasDateRangeFilter(preBidDateFrom, preBidDateTo)
      ? {
          key: "preBidMeetingDate",
          label: "Pre-Bid date",
          group: ["preBidMeetingDate", "refloatPreBidMeetingDate"],
        }
      : undefined,
    hasDateRangeFilter(biddingDateFrom, biddingDateTo)
      ? { key: "bidDate", label: "Bidding date", group: ["bidDate", "refloatBiddingDate"] }
      : undefined,
    hasDateRangeFilter(bidOpeningDateFrom, bidOpeningDateTo)
      ? {
          key: "bidOpeningDate",
          label: "Bid opening date",
          group: ["bidOpeningDate", "refloatBidOpeningDate"],
        }
      : undefined,
    hasDateRangeFilter(financialSanctionFrom, financialSanctionTo)
      ? { key: "financialSanctionDate", label: "Financial sanction date" }
      : undefined,
    hasDateRangeFilter(soDateFrom, soDateTo) ? { key: "soDate", label: "S.O. date" } : undefined,
    hasDateRangeFilter(dpFrom, dpTo)
      ? { key: "dpDate", label: "D.P. period", group: ["dpDate", "revisedDp"] }
      : undefined,
    hasDateRangeFilter(materialReceiptFrom, materialReceiptTo)
      ? { key: "materialReceiptDate", label: "Material receipt date" }
      : undefined,
    hasDateRangeFilter(paymentDateFrom, paymentDateTo)
      ? {
          key: "paymentDate",
          label: "Payment date",
          group: ["paymentDate", "advancePaymentDate", "supplementaryBillPaymentDate"],
        }
      : undefined,
    hasDateRangeFilter(bgReceivedFrom, bgReceivedTo)
      ? {
          key: "psbBgReceivedDate",
          label: "BG received date",
          group: ["psbBgReceivedDate", "pwbBgReceivedDate", "combinedBgReceivedDate"],
        }
      : undefined,
    hasDateRangeFilter(bgValidityFrom, bgValidityTo)
      ? {
          key: "psbBgValidityDate",
          label: "BG validity date",
          group: ["psbBgValidityDate", "pwbBgValidityDate", "combinedBgValidityDate"],
        }
      : undefined,
    hasDateRangeFilter(bgReturnFrom, bgReturnTo)
      ? {
          key: "psbBgReturnDate",
          label: "BG return date",
          group: ["psbBgReturnDate", "pwbBgReturnDate", "combinedBgReturnDate"],
        }
      : undefined,
    hasDateRangeFilter(fileClosureFrom, fileClosureTo)
      ? { key: "fileClosureDate", label: "File closure date" }
      : undefined,
  ].filter((field): field is ComplementaryFieldSelection => Boolean(field));
  const complementaryYesNoApplies = selectedComplementaryYesNoFields.length > 0;
  const complementaryPresenceApplies = selectedComplementaryPresenceFields.length > 0;
  const complementaryYesNoFieldKeys = new Set(
    selectedComplementaryYesNoFields.map((field) => field.key),
  );
  const useComplementaryYesNo = flipYesNoFilters && complementaryYesNoApplies;
  const useComplementaryPresence =
    complementaryPresenceMode !== "none" && complementaryPresenceApplies;

  const activeFilterChips: string[] = [];
  const addFilterChip = (label: string, value?: string) => {
    const cleanValue = value?.trim();
    activeFilterChips.push(cleanValue ? `${label}: ${cleanValue}` : label);
  };
  const addDateRangeChip = (label: string, from: string, to: string) => {
    if (!from && !to) return;
    addFilterChip(label, `${from || "Any"} to ${to || "Any"}`);
  };
  const addIncludeExcludeChip = (label: string, value: IncludeExcludeFilter) => {
    if (value === "none") return;
    addFilterChip(label, value === "include" ? "Only" : "Exclude");
  };
  addFilterChipIf(activeFilterChips, Boolean(yearFilter), "Year", yearFilter);
  addFilterChipIf(activeFilterChips, Boolean(indentor), "Indentor", indentor);
  addFilterChipIf(activeFilterChips, Boolean(divisionFilter), "Division", divisionFilter);
  addFilterChipIf(activeFilterChips, Boolean(description), "Description", description);
  addFilterChipIf(activeFilterChips, Boolean(freeText), "Free search", freeText);
  addFilterChipIf(activeFilterChips, Boolean(freeDate), "Free date", freeDate);
  addFilterChipIf(
    activeFilterChips,
    valueThresholdFilter !== "all",
    "Value band",
    getValueThresholdFilterLabel(valueThresholdFilter, settings.valueThresholdLevels),
  );
  addFilterChipIf(
    activeFilterChips,
    Boolean(valueFrom || valueTo),
    "Value",
    `${valueFrom || "Any"} to ${valueTo || "Any"}`,
  );
  addFilterChipIf(
    activeFilterChips,
    Boolean(soValueFrom || soValueTo),
    "S.O. value",
    `${soValueFrom || "Any"} to ${soValueTo || "Any"}`,
  );
  addFilterChipIf(
    activeFilterChips,
    soValueThresholdFilter !== "all",
    "S.O. value band",
    getValueThresholdFilterLabel(soValueThresholdFilter, settings.valueThresholdLevels),
  );
  if (capitalOnly) addFilterChip("Capital demand");
  if (revenueOnly) addFilterChip("Revenue demand");
  if (soCapitalOnly) addFilterChip("Capital S.O.");
  if (soRevenueOnly) addFilterChip("Revenue S.O.");
  if (selectedFileTypes.length) addFilterChip("File type", selectedFileTypes.join(", "));
  addIncludeExcludeChip("S.O.", soPresenceFilter);
  if (includeModeFilters.length) addFilterChip("Only Mode", includeModeFilters.join(", "));
  if (excludeModeFilters.length) addFilterChip("Exclude Mode", excludeModeFilters.join(", "));
  if (includeGemModeFilters.length)
    addFilterChip("Only GeM mode", includeGemModeFilters.join(", "));
  if (excludeGemModeFilters.length) {
    addFilterChip("Exclude GeM mode", excludeGemModeFilters.join(", "));
  }
  if (selectedFirmTypes.length) addFilterChip("Firm type", selectedFirmTypes.join(", "));
  addFilterChipIf(activeFilterChips, Boolean(firm), "Firm", firm);
  addFilterChipIf(activeFilterChips, Boolean(firmUniqueNo), "Firm Unique No.", firmUniqueNo);
  addFilterChipIf(activeFilterChips, Boolean(firmContactNo), "Contact", firmContactNo);
  addFilterChipIf(activeFilterChips, Boolean(firmCity), "City", firmCity);
  if (!sameStringList(firmSearchScopes, defaultFirmSearchScopes)) {
    const labels = firmSearchScopeOptions
      .filter((scope) => firmSearchScopes.includes(scope.key))
      .map((scope) => scope.label);
    addFilterChip("Firm scope", labels.length ? labels.join(", ") : "None");
  }
  addFilterChipIf(
    activeFilterChips,
    specialFileMarkers.length > 0,
    "Marker",
    specialFileMarkers.join(", "),
  );
  [
    [advancePaymentFilter, "Advance payment"],
    [actualPaymentFilter, "Actual payment"],
    [stageDeliveryFilter, "Stage delivery"],
    [stagePaymentFilter, "Stage payment"],
    [dpExtensionFilter, "DP extension"],
    [ldFilter, "LD"],
    [highValue, "High Value"],
    [gte, "GTE"],
    [ad, "AD"],
    [rqa, "R&QA"],
    [psbFilter, "PSB"],
    [pwbFilter, "PWB"],
    [psbPwbFilter, "PSB+PWB"],
    [bgFilter, "Warranty"],
    [rfpVettingFilter, "RFP vetting"],
    [refloat, "Refloat"],
    [tcec, "TCEC"],
    [preBidMeetingFilter, "Pre-Bid"],
    [rstFilter, "RST"],
    [divisionWiseSort, "Division wise sort"],
  ].forEach(([active, label]) => {
    if (active) addFilterChip(label as string);
  });
  addIncludeExcludeChip("IFA", ifaPresenceFilter);
  addIncludeExcludeChip("CNC", cncPresenceFilter);
  addIncludeExcludeChip("File Closed", fileClosedPresenceFilter);
  addIncludeExcludeChip("Cancelled demand", demandCancelledPresenceFilter);
  addIncludeExcludeChip("Cancelled S.O.", soCancelledPresenceFilter);
  addIncludeExcludeChip("Shortclosed S.O.", shortclosedSoPresenceFilter);
  addDateRangeChip("Demand receipt", demandReceiptFrom, demandReceiptTo);
  addDateRangeChip("Demand control", demandControlFrom, demandControlTo);
  addDateRangeChip("High Value minutes", highValueMinutesFrom, highValueMinutesTo);
  addDateRangeChip("Pre-TCEC date", preTcecDateFrom, preTcecDateTo);
  addDateRangeChip("Pre-TCEC minutes", preTcecMinutesFrom, preTcecMinutesTo);
  addFilterChipIf(
    activeFilterChips,
    Boolean(preTcecCommittee),
    "Pre-TCEC committee",
    preTcecCommittee,
  );
  addDateRangeChip("R&QA approval", rqaApprovalFrom, rqaApprovalTo);
  addDateRangeChip("IFA final", ifaFinalFrom, ifaFinalTo);
  addDateRangeChip("CFA approval", cfaApprovalFrom, cfaApprovalTo);
  addDateRangeChip("Post-TCEC date", postTcecDateFrom, postTcecDateTo);
  addDateRangeChip("Post-TCEC minutes", postTcecMinutesFrom, postTcecMinutesTo);
  addFilterChipIf(
    activeFilterChips,
    Boolean(postTcecCommittee),
    "Post-TCEC committee",
    postTcecCommittee,
  );
  addDateRangeChip("CNC date", cncDateFrom, cncDateTo);
  addDateRangeChip("Pre-Bid date", preBidDateFrom, preBidDateTo);
  addDateRangeChip("Bidding date", biddingDateFrom, biddingDateTo);
  addDateRangeChip("Bid opening date", bidOpeningDateFrom, bidOpeningDateTo);
  addDateRangeChip("Financial sanction", financialSanctionFrom, financialSanctionTo);
  addDateRangeChip("S.O. date", soDateFrom, soDateTo);
  addDateRangeChip("D.P. period", dpFrom, dpTo);
  addDateRangeChip("Material receipt", materialReceiptFrom, materialReceiptTo);
  addDateRangeChip("Bill sent/submitted", billSubmittedFrom, billSubmittedTo);
  addDateRangeChip("Payment date", paymentDateFrom, paymentDateTo);
  addDateRangeChip("BG received", bgReceivedFrom, bgReceivedTo);
  addDateRangeChip("BG validity", bgValidityFrom, bgValidityTo);
  addDateRangeChip("BG return", bgReturnFrom, bgReturnTo);
  addDateRangeChip("File closure", fileClosureFrom, fileClosureTo);
  if (useComplementaryYesNo) {
    addFilterChip(
      "Flip",
      `No for ${formatComplementaryFieldList(selectedComplementaryYesNoFields)}`,
    );
  }
  if (useComplementaryPresence) {
    addFilterChip(
      "Filled/Blank option",
      `${complementaryPresenceMode === "filled" ? "Filled" : "Blank"} for ${formatComplementaryFieldList(
        selectedComplementaryPresenceFields,
      )}`,
    );
  }
  requiredFilledColumnKeys.forEach((key) => {
    const label = printColumns.find((column) => column.key === key)?.label ?? key;
    addFilterChip("Filled", label);
  });
  if (search.dashboardFilter) addFilterChip("Dashboard filter");
  if (search.extraDashboardFilters) addFilterChip("Linked analytics filter");
  if (search.fileYear && search.fileYear !== "all") addFilterChip("File year", search.fileYear);
  addDateRangeChip("Initiation date", search.fileInitiationFrom, search.fileInitiationTo);
  if (search.fileCategories) addFilterChip("Category filter");
  if (search.analyticsNames) addFilterChip("Analytics selection");
  const activeFilterCount = activeFilterChips.length;
  const visibleFilterChips = activeFilterChips.slice(0, 8);
  const hiddenFilterChipCount = Math.max(0, activeFilterChips.length - visibleFilterChips.length);

  const hasFilters =
    yearFilter ||
    indentor ||
    divisionFilter ||
    valueThresholdFilter !== "all" ||
    soValueThresholdFilter !== "all" ||
    valueFrom ||
    valueTo ||
    soValueFrom ||
    soValueTo ||
    soCapitalOnly ||
    soRevenueOnly ||
    capitalOnly ||
    revenueOnly ||
    description ||
    firm ||
    firmUniqueNo ||
    firmContactNo ||
    firmCity ||
    !sameStringList(firmSearchScopes, defaultFirmSearchScopes) ||
    soPresenceFilter !== "none" ||
    selectedModes.length > 0 ||
    selectedGemBiddingModes.length > 0 ||
    selectedFirmTypes.length > 0 ||
    selectedFileTypes.length > 0 ||
    specialFileMarkers.length > 0 ||
    advancePaymentFilter ||
    actualPaymentFilter ||
    stageDeliveryFilter ||
    stagePaymentFilter ||
    dpExtensionFilter ||
    ldFilter ||
    highValue ||
    gte ||
    ad ||
    rqa ||
    ifaPresenceFilter !== "none" ||
    psbFilter ||
    pwbFilter ||
    psbPwbFilter ||
    bgFilter ||
    rfpVettingFilter ||
    refloat ||
    cncPresenceFilter !== "none" ||
    tcec ||
    preBidMeetingFilter ||
    preTcecCommittee ||
    postTcecCommittee ||
    dpFrom ||
    dpTo ||
    demandReceiptFrom ||
    demandReceiptTo ||
    demandControlFrom ||
    demandControlTo ||
    highValueMinutesFrom ||
    highValueMinutesTo ||
    preTcecDateFrom ||
    preTcecDateTo ||
    preTcecMinutesFrom ||
    preTcecMinutesTo ||
    rqaApprovalFrom ||
    rqaApprovalTo ||
    ifaFinalFrom ||
    ifaFinalTo ||
    cfaApprovalFrom ||
    cfaApprovalTo ||
    postTcecDateFrom ||
    postTcecDateTo ||
    postTcecMinutesFrom ||
    postTcecMinutesTo ||
    cncDateFrom ||
    cncDateTo ||
    preBidDateFrom ||
    preBidDateTo ||
    biddingDateFrom ||
    biddingDateTo ||
    bidOpeningDateFrom ||
    bidOpeningDateTo ||
    billSubmittedFrom ||
    billSubmittedTo ||
    financialSanctionFrom ||
    financialSanctionTo ||
    soDateFrom ||
    soDateTo ||
    materialReceiptFrom ||
    materialReceiptTo ||
    paymentDateFrom ||
    paymentDateTo ||
    bgReceivedFrom ||
    bgReceivedTo ||
    bgValidityFrom ||
    bgValidityTo ||
    bgReturnFrom ||
    bgReturnTo ||
    fileClosureFrom ||
    fileClosureTo ||
    useComplementaryYesNo ||
    useComplementaryPresence ||
    fileClosedPresenceFilter !== "none" ||
    rstFilter ||
    demandCancelledPresenceFilter !== "none" ||
    soCancelledPresenceFilter !== "none" ||
    shortclosedSoPresenceFilter !== "none" ||
    freeText ||
    freeDate ||
    requiredFilledColumnKeys.length > 0 ||
    search.dashboardFilter ||
    search.extraDashboardFilters ||
    (search.fileYear && search.fileYear !== "all") ||
    search.fileInitiationFrom ||
    search.fileInitiationTo ||
    search.fileCategories ||
    search.analyticsNames;

  const searchFilterQuery = useMemo(() => {
    const params = new URLSearchParams();
    const isComplementaryYesNoField = (key: string) =>
      useComplementaryYesNo && complementaryYesNoFieldKeys.has(key);
    const keepPresenceRangeFilters = !useComplementaryPresence;

    appendSearchParam(params, "yearFilter", yearFilter);
    appendSearchParam(params, "indentor", indentor);
    appendSearchParam(params, "divisionFilter", divisionFilter);
    appendSearchParam(
      params,
      "valueThresholdFilter",
      valueThresholdFilter === "all" ? "" : valueThresholdFilter,
    );
    appendSearchParam(params, "valueFrom", keepPresenceRangeFilters ? valueFrom : "");
    appendSearchParam(params, "valueTo", keepPresenceRangeFilters ? valueTo : "");
    appendSearchParam(params, "soValueFrom", keepPresenceRangeFilters ? soValueFrom : "");
    appendSearchParam(params, "soValueTo", keepPresenceRangeFilters ? soValueTo : "");
    appendSearchParam(
      params,
      "soValueThresholdFilter",
      soValueThresholdFilter === "all" ? "" : soValueThresholdFilter,
    );
    appendSearchBool(params, "soCapitalOnly", soCapitalOnly);
    appendSearchBool(params, "soRevenueOnly", soRevenueOnly);
    appendSearchParam(params, "description", description);
    appendSearchParam(params, "firm", firm);
    appendSearchParam(params, "firmUniqueNo", firmUniqueNo);
    appendSearchParam(params, "firmContactNo", firmContactNo);
    appendSearchParam(params, "firmCity", firmCity);
    appendSearchList(params, "firmSearchScopes", firmSearchScopes);
    appendIncludeExcludeParam(params, "soPresenceFilter", soPresenceFilter);
    appendSearchList(params, "includeModes", includeModeFilters);
    appendSearchList(params, "excludeModes", excludeModeFilters);
    appendSearchList(params, "includeGemBiddingModes", includeGemModeFilters);
    appendSearchList(params, "excludeGemBiddingModes", excludeGemModeFilters);
    appendSearchList(params, "selectedFirmTypes", selectedFirmTypes);
    appendSearchList(params, "selectedFileTypes", selectedFileTypes);
    appendSearchList(params, "specialFileMarkers", specialFileMarkers);
    appendSearchBool(
      params,
      "advancePaymentFilter",
      advancePaymentFilter && !isComplementaryYesNoField("advancePayment"),
    );
    appendSearchBool(params, "actualPaymentFilter", actualPaymentFilter);
    appendSearchBool(
      params,
      "stageDeliveryFilter",
      stageDeliveryFilter && !isComplementaryYesNoField("stageDelivery"),
    );
    appendSearchBool(
      params,
      "stagePaymentFilter",
      stagePaymentFilter && !isComplementaryYesNoField("stagePayment"),
    );
    appendSearchBool(
      params,
      "dpExtensionFilter",
      dpExtensionFilter && !isComplementaryYesNoField("dpExtension"),
    );
    appendSearchBool(params, "ldFilter", ldFilter && !isComplementaryYesNoField("ld"));
    appendSearchBool(params, "capitalOnly", capitalOnly);
    appendSearchBool(params, "revenueOnly", revenueOnly);
    appendSearchBool(params, "highValue", highValue && !isComplementaryYesNoField("highValue"));
    appendSearchBool(params, "gte", gte && !isComplementaryYesNoField("gte"));
    appendSearchBool(params, "ad", ad && !isComplementaryYesNoField("ad"));
    appendSearchBool(params, "rqa", rqa && !isComplementaryYesNoField("rqa"));
    appendIncludeExcludeParam(
      params,
      "ifaPresenceFilter",
      isComplementaryYesNoField("ifa") ? "none" : ifaPresenceFilter,
    );
    appendSearchBool(params, "psbFilter", psbFilter);
    appendSearchBool(params, "pwbFilter", pwbFilter);
    appendSearchBool(params, "psbPwbFilter", psbPwbFilter);
    appendSearchBool(params, "bgFilter", bgFilter && !isComplementaryYesNoField("bg"));
    appendSearchBool(
      params,
      "rfpVettingFilter",
      rfpVettingFilter && !isComplementaryYesNoField("rfpVetting"),
    );
    appendSearchBool(params, "refloat", refloat && !isComplementaryYesNoField("refloat"));
    appendIncludeExcludeParam(
      params,
      "cncPresenceFilter",
      isComplementaryYesNoField("cnc") ? "none" : cncPresenceFilter,
    );
    appendSearchBool(params, "tcec", tcec && !isComplementaryYesNoField("tcec"));
    appendSearchBool(
      params,
      "preBidMeetingFilter",
      preBidMeetingFilter && !isComplementaryYesNoField("preBidMeeting"),
    );
    appendSearchParam(params, "preTcecCommittee", preTcecCommittee);
    appendSearchParam(params, "postTcecCommittee", postTcecCommittee);
    appendSearchParam(params, "dpFrom", keepPresenceRangeFilters ? dpFrom : "");
    appendSearchParam(params, "dpTo", keepPresenceRangeFilters ? dpTo : "");
    appendSearchParam(
      params,
      "demandReceiptFrom",
      keepPresenceRangeFilters ? demandReceiptFrom : "",
    );
    appendSearchParam(params, "demandReceiptTo", keepPresenceRangeFilters ? demandReceiptTo : "");
    appendSearchParam(
      params,
      "demandControlFrom",
      keepPresenceRangeFilters ? demandControlFrom : "",
    );
    appendSearchParam(params, "demandControlTo", keepPresenceRangeFilters ? demandControlTo : "");
    appendSearchParam(
      params,
      "highValueMinutesFrom",
      keepPresenceRangeFilters ? highValueMinutesFrom : "",
    );
    appendSearchParam(
      params,
      "highValueMinutesTo",
      keepPresenceRangeFilters ? highValueMinutesTo : "",
    );
    appendSearchParam(params, "preTcecDateFrom", keepPresenceRangeFilters ? preTcecDateFrom : "");
    appendSearchParam(params, "preTcecDateTo", keepPresenceRangeFilters ? preTcecDateTo : "");
    appendSearchParam(
      params,
      "preTcecMinutesFrom",
      keepPresenceRangeFilters ? preTcecMinutesFrom : "",
    );
    appendSearchParam(params, "preTcecMinutesTo", keepPresenceRangeFilters ? preTcecMinutesTo : "");
    appendSearchParam(params, "rqaApprovalFrom", keepPresenceRangeFilters ? rqaApprovalFrom : "");
    appendSearchParam(params, "rqaApprovalTo", keepPresenceRangeFilters ? rqaApprovalTo : "");
    appendSearchParam(params, "ifaFinalFrom", keepPresenceRangeFilters ? ifaFinalFrom : "");
    appendSearchParam(params, "ifaFinalTo", keepPresenceRangeFilters ? ifaFinalTo : "");
    appendSearchParam(params, "cfaApprovalFrom", keepPresenceRangeFilters ? cfaApprovalFrom : "");
    appendSearchParam(params, "cfaApprovalTo", keepPresenceRangeFilters ? cfaApprovalTo : "");
    appendSearchParam(params, "postTcecDateFrom", keepPresenceRangeFilters ? postTcecDateFrom : "");
    appendSearchParam(params, "postTcecDateTo", keepPresenceRangeFilters ? postTcecDateTo : "");
    appendSearchParam(
      params,
      "postTcecMinutesFrom",
      keepPresenceRangeFilters ? postTcecMinutesFrom : "",
    );
    appendSearchParam(
      params,
      "postTcecMinutesTo",
      keepPresenceRangeFilters ? postTcecMinutesTo : "",
    );
    appendSearchParam(params, "cncDateFrom", keepPresenceRangeFilters ? cncDateFrom : "");
    appendSearchParam(params, "cncDateTo", keepPresenceRangeFilters ? cncDateTo : "");
    appendSearchParam(params, "preBidDateFrom", keepPresenceRangeFilters ? preBidDateFrom : "");
    appendSearchParam(params, "preBidDateTo", keepPresenceRangeFilters ? preBidDateTo : "");
    appendSearchParam(params, "biddingDateFrom", keepPresenceRangeFilters ? biddingDateFrom : "");
    appendSearchParam(params, "biddingDateTo", keepPresenceRangeFilters ? biddingDateTo : "");
    appendSearchParam(
      params,
      "bidOpeningDateFrom",
      keepPresenceRangeFilters ? bidOpeningDateFrom : "",
    );
    appendSearchParam(params, "bidOpeningDateTo", keepPresenceRangeFilters ? bidOpeningDateTo : "");
    appendSearchParam(
      params,
      "billSubmittedFrom",
      keepPresenceRangeFilters ? billSubmittedFrom : "",
    );
    appendSearchParam(params, "billSubmittedTo", keepPresenceRangeFilters ? billSubmittedTo : "");
    appendSearchParam(
      params,
      "financialSanctionFrom",
      keepPresenceRangeFilters ? financialSanctionFrom : "",
    );
    appendSearchParam(
      params,
      "financialSanctionTo",
      keepPresenceRangeFilters ? financialSanctionTo : "",
    );
    appendSearchParam(params, "soDateFrom", keepPresenceRangeFilters ? soDateFrom : "");
    appendSearchParam(params, "soDateTo", keepPresenceRangeFilters ? soDateTo : "");
    appendSearchParam(
      params,
      "materialReceiptFrom",
      keepPresenceRangeFilters ? materialReceiptFrom : "",
    );
    appendSearchParam(
      params,
      "materialReceiptTo",
      keepPresenceRangeFilters ? materialReceiptTo : "",
    );
    appendSearchParam(params, "paymentDateFrom", keepPresenceRangeFilters ? paymentDateFrom : "");
    appendSearchParam(params, "paymentDateTo", keepPresenceRangeFilters ? paymentDateTo : "");
    appendSearchParam(params, "bgReceivedFrom", keepPresenceRangeFilters ? bgReceivedFrom : "");
    appendSearchParam(params, "bgReceivedTo", keepPresenceRangeFilters ? bgReceivedTo : "");
    appendSearchParam(params, "bgValidityFrom", keepPresenceRangeFilters ? bgValidityFrom : "");
    appendSearchParam(params, "bgValidityTo", keepPresenceRangeFilters ? bgValidityTo : "");
    appendSearchParam(params, "bgReturnFrom", keepPresenceRangeFilters ? bgReturnFrom : "");
    appendSearchParam(params, "bgReturnTo", keepPresenceRangeFilters ? bgReturnTo : "");
    appendSearchParam(params, "fileClosureFrom", keepPresenceRangeFilters ? fileClosureFrom : "");
    appendSearchParam(params, "fileClosureTo", keepPresenceRangeFilters ? fileClosureTo : "");
    appendSearchParam(
      params,
      "fieldConditionYesNoFields",
      useComplementaryYesNo ? encodeComplementaryFieldGroups(selectedComplementaryYesNoFields) : "",
    );
    appendSearchParam(params, "fieldConditionYesNoMode", useComplementaryYesNo ? "no" : "");
    appendSearchParam(
      params,
      "fieldConditionPresenceFields",
      useComplementaryPresence
        ? encodeComplementaryFieldGroups(selectedComplementaryPresenceFields)
        : "",
    );
    appendSearchParam(
      params,
      "fieldConditionPresenceMode",
      useComplementaryPresence ? complementaryPresenceMode : "",
    );
    appendIncludeExcludeParam(params, "fileClosedPresenceFilter", fileClosedPresenceFilter);
    appendSearchBool(params, "rstFilter", rstFilter);
    appendIncludeExcludeParam(
      params,
      "demandCancelledPresenceFilter",
      isComplementaryYesNoField("demandCancelled") ? "none" : demandCancelledPresenceFilter,
    );
    appendIncludeExcludeParam(
      params,
      "soCancelledPresenceFilter",
      isComplementaryYesNoField("soCancelled") ? "none" : soCancelledPresenceFilter,
    );
    appendIncludeExcludeParam(
      params,
      "shortclosedSoPresenceFilter",
      isComplementaryYesNoField("shortclosure") ? "none" : shortclosedSoPresenceFilter,
    );
    appendSearchParam(params, "freeText", freeText);
    appendSearchParam(params, "freeDate", freeDate);
    appendSearchParam(params, "selectedYear", search.selectedYear ?? settings.selectedYear);
    appendSearchParam(params, "fileYear", search.fileYear);
    appendSearchParam(params, "fileInitiationFrom", search.fileInitiationFrom);
    appendSearchParam(params, "fileInitiationTo", search.fileInitiationTo);
    appendSearchParam(params, "dashboardFilter", search.dashboardFilter);
    appendSearchParam(params, "extraDashboardFilters", search.extraDashboardFilters);
    appendSearchParam(params, "fileCategories", search.fileCategories);
    appendSearchParam(params, "analyticsType", search.analyticsType);
    appendSearchParam(params, "analyticsNames", search.analyticsNames);
    appendSearchParam(params, "drillPath", search.drillPath);
    appendSearchParam(params, "sortColumnKey", activeSortColumnKey);
    appendSearchParam(params, "sortDirection", sortDirection);
    appendSearchBool(params, "divisionWiseSort", divisionWiseSort);
    appendSearchList(params, "requiredFilledFields", visibleRequiredFilledColumnKeys);

    return params.toString();
  }, [
    activeSortColumnKey,
    sortDirection,
    divisionWiseSort,
    visibleRequiredFilledColumnSignature,
    yearFilter,
    search.dashboardFilter,
    search.extraDashboardFilters,
    search.fileYear,
    search.fileInitiationFrom,
    search.fileInitiationTo,
    search.fileCategories,
    indentor,
    divisionFilter,
    valueThresholdFilter,
    soValueThresholdFilter,
    valueFrom,
    valueTo,
    soValueFrom,
    soValueTo,
    soCapitalOnly,
    soRevenueOnly,
    capitalOnly,
    revenueOnly,
    description,
    firm,
    selectedModes,
    selectedGemBiddingModes,
    includeModeFilters,
    excludeModeFilters,
    includeGemModeFilters,
    excludeGemModeFilters,
    selectedFirmTypes,
    firmUniqueNo,
    firmContactNo,
    firmCity,
    firmSearchScopes,
    soPresenceFilter,
    selectedFileTypes,
    specialFileMarkers,
    advancePaymentFilter,
    actualPaymentFilter,
    stageDeliveryFilter,
    stagePaymentFilter,
    dpExtensionFilter,
    ldFilter,
    highValue,
    gte,
    ad,
    rqa,
    ifaPresenceFilter,
    psbFilter,
    pwbFilter,
    psbPwbFilter,
    bgFilter,
    rfpVettingFilter,
    refloat,
    cncPresenceFilter,
    tcec,
    preBidMeetingFilter,
    preTcecCommittee,
    postTcecCommittee,
    dpFrom,
    dpTo,
    demandReceiptFrom,
    demandReceiptTo,
    demandControlFrom,
    demandControlTo,
    highValueMinutesFrom,
    highValueMinutesTo,
    preTcecDateFrom,
    preTcecDateTo,
    preTcecMinutesFrom,
    preTcecMinutesTo,
    rqaApprovalFrom,
    rqaApprovalTo,
    ifaFinalFrom,
    ifaFinalTo,
    cfaApprovalFrom,
    cfaApprovalTo,
    postTcecDateFrom,
    postTcecDateTo,
    postTcecMinutesFrom,
    postTcecMinutesTo,
    cncDateFrom,
    cncDateTo,
    preBidDateFrom,
    preBidDateTo,
    biddingDateFrom,
    biddingDateTo,
    bidOpeningDateFrom,
    bidOpeningDateTo,
    billSubmittedFrom,
    billSubmittedTo,
    financialSanctionFrom,
    financialSanctionTo,
    soDateFrom,
    soDateTo,
    materialReceiptFrom,
    materialReceiptTo,
    paymentDateFrom,
    paymentDateTo,
    bgReceivedFrom,
    bgReceivedTo,
    bgValidityFrom,
    bgValidityTo,
    bgReturnFrom,
    bgReturnTo,
    fileClosureFrom,
    fileClosureTo,
    flipYesNoFilters,
    complementaryPresenceMode,
    useComplementaryYesNo,
    useComplementaryPresence,
    fileClosedPresenceFilter,
    rstFilter,
    demandCancelledPresenceFilter,
    soCancelledPresenceFilter,
    shortclosedSoPresenceFilter,
    freeText,
    freeDate,
    search.selectedYear,
    settings.selectedYear,
    search.analyticsType,
    search.analyticsNames,
    search.drillPath,
  ]);

  useEffect(() => {
    setPage(1);
  }, [searchFilterQuery]);

  useEffect(() => {
    if (!complementaryYesNoApplies && flipYesNoFilters) {
      setFlipYesNoFilters(false);
    }
  }, [complementaryYesNoApplies, flipYesNoFilters]);

  useEffect(() => {
    if (!complementaryPresenceApplies && complementaryPresenceMode !== "none") {
      setComplementaryPresenceMode("none");
    }
  }, [complementaryPresenceApplies, complementaryPresenceMode]);

  const searchQuery = useMemo(() => {
    const params = new URLSearchParams(searchFilterQuery);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [page, pageSize, searchFilterQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const delay = hasLoadedSearchResultsRef.current ? 180 : 0;
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(undefined);
      fetchBackendSearchResults(searchQuery, controller.signal)
        .then((payload) => {
          setBackendResults(payload.files);
          setSearchTotal(payload.total);
          setSearchSummaryTotals(payload.summaryTotals ?? {});
          setPage((current) => (payload.page !== current ? payload.page : current));
          setPageSize((current) => (payload.pageSize !== current ? payload.pageSize : current));
          setHasLoadedSearchResults(true);
          hasLoadedSearchResultsRef.current = true;
          setSelectedFileIds((current) =>
            current.filter((id) => payload.files.some((file) => file.id === id)),
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(error);
          setSearchError(error instanceof Error ? error.message : "Search request failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery]);

  const results = backendResults;
  const totalPages = Math.max(1, Math.ceil(searchTotal / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstResultNumber = searchTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastResultNumber = Math.min(searchTotal, (currentPage - 1) * pageSize + results.length);
  const searchDisplayRows = useMemo(
    () =>
      buildSearchDisplayRows(
        results,
        selectedTableColumns,
        expandedSearchFileIds,
        firstResultNumber,
      ),
    [expandedSearchFileIds, firstResultNumber, results, selectedTableColumns],
  );
  const visibleExpandableFileIds = useMemo(
    () => results.filter(hasDetailedSearchRows).map((file) => file.id),
    [results],
  );
  const allVisibleSearchRowsExpanded =
    visibleExpandableFileIds.length > 0 &&
    visibleExpandableFileIds.every((fileId) => expandedSearchFileIds.has(fileId));

  const selectedResultFiles = results.filter((file) => selectedFileIds.includes(file.id));
  const allVisibleRowsSelected =
    results.length > 0 && results.every((file) => selectedFileIds.includes(file.id));
  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  };
  const toggleVisibleRowsSelection = () => {
    setSelectedFileIds((current) => {
      const visibleIds = results.map((file) => file.id);
      if (visibleIds.length === 0) return current;
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };
  const toggleTableColumn = (key: string) => {
    setSelectedTableColumnKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };
  const toggleRequiredFilledColumn = (key: string) => {
    setRequiredFilledColumnKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };
  const setColumnHeaderSort = (key: string, direction: SortDirection) => {
    setSortColumnKey(key);
    setSortDirection(direction);
  };
  const applyTablePreset = (presetId: string) => {
    setActiveTablePresetId(presetId);
    if (presetId === manualTablePresetId) {
      setSelectedTableColumnKeys(defaultTableColumnKeys ?? allTableColumnKeys);
      return;
    }
    const preset = tableFieldPresets.find((item) => item.id === presetId);
    setSelectedTableColumnKeys(preset ? getValidTableColumnKeys(preset.fieldKeys) : []);
  };
  const setModeFilter = (mode: string, value: IncludeExcludeFilter) => {
    setModeFilters((current) => updateSingleOnlyMultiExcludeFilter(current, mode, value));
  };
  const setGemModeFilter = (mode: string, value: IncludeExcludeFilter) => {
    setGemModeFilters((current) => updateSingleOnlyMultiExcludeFilter(current, mode, value));
  };
  const toggleFirmTypeFilter = (firmType: string, checked: boolean) => {
    setSelectedFirmTypes((current) =>
      checked
        ? Array.from(new Set([...current, firmType]))
        : current.filter((item) => item !== firmType),
    );
  };
  const toggleFirmSearchScope = (scope: string, checked: boolean) => {
    setFirmSearchScopes((current) => {
      const next = checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((item) => item !== scope);
      return next.length ? next : current;
    });
  };
  const toggleFileTypeFilter = (fileType: string, checked: boolean) => {
    setSelectedFileTypes((current) =>
      checked
        ? Array.from(new Set([...current, fileType]))
        : current.filter((item) => item !== fileType),
    );
  };
  const saveTableDefaultFields = () => {
    if (!tableDefaultChanged) {
      if (selectedTableColumnKeys.length === 0) {
        alert("Select at least one table field to save as default.");
      }
      return;
    }
    if (selectedTableColumnKeys.length === 0) {
      alert("Select at least one table field to save as default.");
      return;
    }
    setDefaultTableColumnKeys(selectedTableColumnKeys);
    localStorage.setItem(
      tableDefaultStorageKey(settings.activeUserId),
      JSON.stringify(selectedTableColumnKeys),
    );
  };
  const applyTableDefaultFields = () => {
    if (!defaultTableColumnKeys) {
      alert("No table field default has been saved for this user.");
      return;
    }
    setSelectedTableColumnKeys(defaultTableColumnKeys);
  };
  const clearTableDefaultFields = () => {
    setDefaultTableColumnKeys(null);
    setSelectedTableColumnKeys(allTableColumnKeys);
    localStorage.removeItem(tableDefaultStorageKey(settings.activeUserId));
  };

  const clearAll = () => {
    setYearFilter("");
    setIndentor("");
    setDivisionFilter("");
    setValueThresholdFilter("all");
    setSoValueThresholdFilter("all");
    setValueFrom("");
    setValueTo("");
    setSoValueFrom("");
    setSoValueTo("");
    setSoCapitalOnly(false);
    setSoRevenueOnly(false);
    setCapitalOnly(false);
    setRevenueOnly(false);
    setDescription("");
    setFirm("");
    setFirmUniqueNo("");
    setFirmContactNo("");
    setFirmCity("");
    setFirmSearchScopes(defaultFirmSearchScopes);
    setSoPresenceFilter("none");
    setModeFilters({});
    setGemModeFilters({});
    setSelectedFirmTypes([]);
    setSelectedFileTypes([]);
    setSpecialFileMarkers([]);
    setAdvancePaymentFilter(false);
    setActualPaymentFilter(false);
    setStageDeliveryFilter(false);
    setStagePaymentFilter(false);
    setDpExtensionFilter(false);
    setLdFilter(false);
    setHighValue(false);
    setGte(false);
    setAd(false);
    setRqa(false);
    setIfaPresenceFilter("none");
    setPsbFilter(false);
    setPwbFilter(false);
    setPsbPwbFilter(false);
    setBgFilter(false);
    setRfpVettingFilter(false);
    setRefloat(false);
    setCncPresenceFilter("none");
    setTcec(false);
    setPreBidMeetingFilter(false);
    setPreTcecCommittee("");
    setPostTcecCommittee("");
    setDpFrom("");
    setDpTo("");
    setDemandReceiptFrom("");
    setDemandReceiptTo("");
    setDemandControlFrom("");
    setDemandControlTo("");
    setHighValueMinutesFrom("");
    setHighValueMinutesTo("");
    setPreTcecDateFrom("");
    setPreTcecDateTo("");
    setPreTcecMinutesFrom("");
    setPreTcecMinutesTo("");
    setRqaApprovalFrom("");
    setRqaApprovalTo("");
    setIfaFinalFrom("");
    setIfaFinalTo("");
    setCfaApprovalFrom("");
    setCfaApprovalTo("");
    setPostTcecDateFrom("");
    setPostTcecDateTo("");
    setPostTcecMinutesFrom("");
    setPostTcecMinutesTo("");
    setCncDateFrom("");
    setCncDateTo("");
    setPreBidDateFrom("");
    setPreBidDateTo("");
    setBiddingDateFrom("");
    setBiddingDateTo("");
    setBidOpeningDateFrom("");
    setBidOpeningDateTo("");
    setBillSubmittedFrom("");
    setBillSubmittedTo("");
    setFinancialSanctionFrom("");
    setFinancialSanctionTo("");
    setSoDateFrom("");
    setSoDateTo("");
    setMaterialReceiptFrom("");
    setMaterialReceiptTo("");
    setPaymentDateFrom("");
    setPaymentDateTo("");
    setBgReceivedFrom("");
    setBgReceivedTo("");
    setBgValidityFrom("");
    setBgValidityTo("");
    setBgReturnFrom("");
    setBgReturnTo("");
    setFileClosureFrom("");
    setFileClosureTo("");
    setFlipYesNoFilters(false);
    setComplementaryPresenceMode("none");
    setFileClosedPresenceFilter("none");
    setRstFilter(false);
    setDemandCancelledPresenceFilter("none");
    setSoCancelledPresenceFilter("none");
    setShortclosedSoPresenceFilter("none");
    setFreeText("");
    setFreeDate("");
    setSortColumnKey("none");
    setSortDirection("asc");
    setDivisionWiseSort(false);
    setRequiredFilledColumnKeys([]);
    if (
      search.dashboardFilter ||
      search.division ||
      search.analyticsType ||
      search.analyticsNames ||
      (search.fileYear && search.fileYear !== "all") ||
      search.fileInitiationFrom ||
      search.fileInitiationTo ||
      search.fileCategories ||
      search.drillPath
    ) {
      navigate({
        to: "/search",
        search: {
          dashboardFilter: undefined,
          division: undefined,
          analyticsType: undefined,
          analyticsNames: undefined,
          fileYear: undefined,
          fileInitiationFrom: undefined,
          fileInitiationTo: undefined,
          fileCategories: undefined,
          drillPath: undefined,
        },
      });
    }
  };
  const renderPaginationControls = () => (
    <>
      <label className="inline-flex items-center gap-2">
        <span>Rows</span>
        <select
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        >
          {searchPageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <SearchPaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        loading={searchLoading}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />
    </>
  );
  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Search Files</h2>
            {drillPath.length ? (
              <DrillPathTrail
                items={[...drillPath, { label: "Search Files", href: currentSearchHref }]}
                fallbackHref={currentSearchHref}
              />
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              Find records, open timelines, print file sheets, or edit file details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border bg-secondary/50 px-3 py-2">
              <span className="font-medium text-foreground">{searchTotal}</span> records
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Filter className="size-3.5" />
              <span className="font-medium text-foreground">{searchTotal}</span> result
              {searchTotal !== 1 && "s"}
            </span>
            <span>
              Showing{" "}
              <span className="font-medium text-foreground">
                {firstResultNumber}-{lastResultNumber}
              </span>
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={
                allVisibleSearchRowsExpanded
                  ? collapseAllVisibleSearchRows
                  : expandAllVisibleSearchRows
              }
              disabled={!visibleExpandableFileIds.length}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {allVisibleSearchRowsExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {allVisibleSearchRowsExpanded ? "Collapse all" : "Expand all"}
            </button>
            <label className="inline-flex items-center gap-2">
              <span>Preset fields</span>
              <select
                value={activeTablePresetId}
                onChange={(event) => applyTablePreset(event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value={manualTablePresetId}>Manual</option>
                {tableFieldPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name || "Unnamed preset"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                printSearchList(
                  selectedResultFiles.length ? selectedResultFiles : results,
                  selectedTableColumns,
                  selectedResultFiles.length ? undefined : searchFilterQuery,
                  "rowwise",
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              <Printer className="size-3.5" />{" "}
              {selectedResultFiles.length ? "Print selected" : "Print list"}
            </button>
            <button
              type="button"
              onClick={() =>
                exportSearchList(
                  selectedResultFiles.length ? selectedResultFiles : results,
                  selectedTableColumns,
                  "rowwise",
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              <FileSpreadsheet className="size-3.5" />{" "}
              {selectedResultFiles.length ? "Export selected" : "Export Excel"}
            </button>
            <button
              type="button"
              onClick={() => setShowTableOptions((current) => !current)}
              disabled={!manualTableFieldsSelected}
              title={
                manualTableFieldsSelected
                  ? "Choose manual table fields"
                  : `Using ${selectedTablePreset?.name || "preset"} fields`
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              <SlidersHorizontal className="size-3.5" /> Table fields
            </button>
            <SearchHelper items={searchFilterHelpers.tableFields} label="Table fields help" />
            {renderPaginationControls()}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-2.5 shadow-[var(--shadow-card)] flex min-w-0 items-center gap-2">
        <Search className="size-4 text-muted-foreground ml-2" />
        <input
          value={freeText}
          onChange={(event) => setFreeText(event.target.value)}
          placeholder="Free search"
          className="flex-1 h-10 bg-transparent outline-none text-sm"
        />
        <SearchHelper items={searchFilterHelpers.freeSearch} label="Free search help" />
      </div>

      {(searchError || (searchLoading && !hasLoadedSearchResults)) && (
        <div
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (searchError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-secondary/40 text-muted-foreground")
          }
        >
          {searchError ? searchError : "Updating search results..."}
        </div>
      )}

      <div
        className={
          "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 shadow-[var(--shadow-card)] " +
          (activeFilterCount > 0
            ? "border-destructive/50 bg-destructive/5"
            : "border-border bg-card")
        }
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((current) => !current)}
            className={
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent " +
              (activeFilterCount > 0
                ? "border-destructive/60 bg-destructive/10 text-destructive"
                : "border-border bg-background text-foreground")
            }
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal
              className={
                "size-4 " + (activeFilterCount > 0 ? "text-destructive" : "text-muted-foreground")
              }
            />
            Filters
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          <SearchHelper items={searchFilterHelpers.filters} label="Search filters help" />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1">
            <label
              className="inline-flex items-center gap-1.5 text-xs"
              title={formatComplementaryFieldList(selectedComplementaryYesNoFields)}
            >
              <input
                type="checkbox"
                checked={flipYesNoFilters}
                onChange={(event) => setFlipYesNoFilters(event.target.checked)}
                disabled={!complementaryYesNoApplies}
                className="size-3.5 accent-primary disabled:opacity-45"
              />
              <span
                className={
                  "font-medium " +
                  (complementaryYesNoApplies ? "text-foreground" : "text-muted-foreground")
                }
              >
                Flip
              </span>
              <SearchHelper items={searchFilterHelpers.yesNoComplement} label="Flip help" />
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <span className="font-medium text-muted-foreground">Filled/Blank</span>
              <select
                value={complementaryPresenceMode}
                onChange={(event) =>
                  setComplementaryPresenceMode(event.target.value as ComplementaryPresenceMode)
                }
                disabled={!complementaryPresenceApplies}
                title={formatComplementaryFieldList(selectedComplementaryPresenceFields)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-45"
              >
                <option value="none">
                  {complementaryPresenceApplies ? "Ignore" : "Select date/value filter"}
                </option>
                <option value="filled">Filled</option>
                <option value="blank">Blank</option>
              </select>
              <SearchHelper
                items={searchFilterHelpers.filledBlankComplement}
                label="Filled/Blank complementary help"
              />
            </label>
          </div>
          {visibleFilterChips.length ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {visibleFilterChips.map((chip, index) => (
                <span
                  key={`${chip}-${index}`}
                  className={
                    "max-w-48 truncate rounded-full border px-2.5 py-1 text-xs font-medium " +
                    (activeFilterCount > 0
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-border bg-secondary/40 text-muted-foreground")
                  }
                  title={chip}
                >
                  {chip}
                </span>
              ))}
              {hiddenFilterChipCount > 0 ? (
                <span
                  className={
                    "rounded-full border px-2.5 py-1 text-xs font-semibold " +
                    (activeFilterCount > 0
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-border bg-secondary/40 text-foreground")
                  }
                  title={activeFilterChips.slice(visibleFilterChips.length).join(", ")}
                >
                  +{hiddenFilterChipCount}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No filters selected</span>
          )}
        </div>
        <button
          type="button"
          onClick={clearAll}
          disabled={!hasFilters}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <X className="size-3.5" /> Reset filters
        </button>
      </div>

      <div
        className={
          "grid min-w-0 grid-cols-1 gap-4 " +
          (filtersOpen ? "xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]" : "")
        }
      >
        {filtersOpen ? (
          <aside className="bg-card border border-border rounded-md p-4 shadow-[var(--shadow-card)] h-fit min-w-0 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <SlidersHorizontal className="size-4 text-muted-foreground" /> Filters
              </div>
            </div>

            <FilterGroup label="File type" helper={searchFilterHelpers.fileType}>
              <div className="grid grid-cols-2 gap-2">
                {getConfiguredFileTypeOptions(settings.fileTypes, selectedFileTypes).map(
                  (fileType) => (
                    <CheckFilter
                      key={fileType}
                      label={fileType}
                      checked={selectedFileTypes.includes(fileType)}
                      onChange={(checked) => toggleFileTypeFilter(fileType, checked)}
                    />
                  ),
                )}
              </div>
            </FilterGroup>

            <FilterGroup label="Year" helper={searchFilterHelpers.year}>
              <FilterInput
                value={yearFilter}
                onChange={setYearFilter}
                placeholder="All years"
                options={years}
              />
            </FilterGroup>

            <FilterGroup label="Indentor" helper={searchFilterHelpers.indentor}>
              <FilterInput value={indentor} onChange={setIndentor} placeholder="Indentor" />
            </FilterGroup>

            <FilterGroup label="Division" helper={searchFilterHelpers.division}>
              <FilterInput
                value={divisionFilter}
                onChange={setDivisionFilter}
                placeholder="All divisions"
                options={divisionOptions}
              />
            </FilterGroup>

            <FilterGroup
              label="Value"
              helper={searchFilterHelpers.value}
              active={valueThresholdFilter !== "all" || Boolean(valueFrom || valueTo)}
            >
              <select
                value={valueThresholdFilter}
                onChange={(event) => setValueThresholdFilter(event.target.value)}
                className={filterControlClass(
                  valueThresholdFilter !== "all",
                  "mb-2 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40",
                )}
              >
                <option value="all">All value bands</option>
                {settings.valueThresholdLevels.map((level) => (
                  <option
                    key={level.id ?? level.levelNumber}
                    value={getValueThresholdFilterValue(level)}
                  >
                    {formatValueThresholdOption(level)}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <FilterInput
                  value={valueFrom}
                  onChange={setValueFrom}
                  placeholder="From"
                  decimalOnly
                />
                <FilterInput value={valueTo} onChange={setValueTo} placeholder="To" decimalOnly />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CheckFilter label="Capital" checked={capitalOnly} onChange={setCapitalOnly} />
                <CheckFilter label="Revenue" checked={revenueOnly} onChange={setRevenueOnly} />
              </div>
            </FilterGroup>

            <FilterGroup
              label="S.O. value"
              helper={searchFilterHelpers.soValue}
              active={soValueThresholdFilter !== "all" || Boolean(soValueFrom || soValueTo)}
            >
              <select
                value={soValueThresholdFilter}
                onChange={(event) => setSoValueThresholdFilter(event.target.value)}
                className={filterControlClass(
                  soValueThresholdFilter !== "all",
                  "mb-2 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40",
                )}
              >
                <option value="all">All S.O. value bands</option>
                {settings.valueThresholdLevels.map((level) => (
                  <option
                    key={level.id ?? level.levelNumber}
                    value={getSoValueThresholdFilterValue(level)}
                  >
                    {formatValueThresholdOption(level)}
                  </option>
                ))}
              </select>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <FilterInput
                  value={soValueFrom}
                  onChange={setSoValueFrom}
                  placeholder="From"
                  decimalOnly
                />
                <FilterInput
                  value={soValueTo}
                  onChange={setSoValueTo}
                  placeholder="To"
                  decimalOnly
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CheckFilter label="Capital" checked={soCapitalOnly} onChange={setSoCapitalOnly} />
                <CheckFilter label="Revenue" checked={soRevenueOnly} onChange={setSoRevenueOnly} />
              </div>
            </FilterGroup>

            <FilterGroup label="Description" helper={searchFilterHelpers.description}>
              <FilterInput
                value={description}
                onChange={setDescription}
                placeholder="Demand description"
              />
            </FilterGroup>

            <FilterGroup label="Firm type" helper={searchFilterHelpers.firmType}>
              <div className="grid grid-cols-2 gap-2">
                {firmTypeOptions.map((firmType) => (
                  <CheckFilter
                    key={firmType}
                    label={firmType}
                    checked={selectedFirmTypes.includes(firmType)}
                    onChange={(checked) => toggleFirmTypeFilter(firmType, checked)}
                  />
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="S.O." helper={searchFilterHelpers.supplyOrderPresence}>
              <ThreeWayFilter
                label="S.O. exists"
                value={soPresenceFilter}
                onChange={setSoPresenceFilter}
              />
            </FilterGroup>

            <FilterGroup label="Payment criteria" helper={searchFilterHelpers.paymentCriteria}>
              <CheckFilter
                label="Advance Payment"
                checked={advancePaymentFilter}
                onChange={setAdvancePaymentFilter}
              />
              <CheckFilter
                label="Actual payment made"
                checked={actualPaymentFilter}
                onChange={setActualPaymentFilter}
              />
              <CheckFilter
                label="Stage delivery"
                checked={stageDeliveryFilter}
                onChange={setStageDeliveryFilter}
              />
              <CheckFilter
                label="Stage payment"
                checked={stagePaymentFilter}
                onChange={setStagePaymentFilter}
              />
              <CheckFilter
                label="DP extension"
                checked={dpExtensionFilter}
                onChange={setDpExtensionFilter}
              />
              <CheckFilter label="LD" checked={ldFilter} onChange={setLdFilter} />
            </FilterGroup>

            <FilterGroup label="Bidding mode" helper={searchFilterHelpers.biddingMode}>
              <div className="grid grid-cols-2 gap-2">
                {modeFilterOptions.map((mode) => (
                  <ThreeWayFilter
                    key={mode}
                    label={mode}
                    value={modeFilters[mode] ?? "none"}
                    onChange={(value) => setModeFilter(mode, value)}
                  />
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="GeM Bidding Mode" helper={searchFilterHelpers.gemBiddingMode}>
              <div className="grid grid-cols-2 gap-2">
                {gemBiddingModeOptions.map((mode) => (
                  <ThreeWayFilter
                    key={mode}
                    label={mode}
                    value={gemModeFilters[mode] ?? "none"}
                    onChange={(value) => setGemModeFilter(mode, value)}
                  />
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="Workflow flags" helper={searchFilterHelpers.workflowFlags}>
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
                <CheckFilter label="High Value" checked={highValue} onChange={setHighValue} />
                <CheckFilter label="GTE" checked={gte} onChange={setGte} />
                <CheckFilter label="AD" checked={ad} onChange={setAd} />
                <CheckFilter label="R&QA" checked={rqa} onChange={setRqa} />
                <ThreeWayFilter
                  label="IFA"
                  value={ifaPresenceFilter}
                  onChange={setIfaPresenceFilter}
                />
                <CheckFilter label="PSB" checked={psbFilter} onChange={setPsbFilter} />
                <CheckFilter label="PWB" checked={pwbFilter} onChange={setPwbFilter} />
                <CheckFilter label="PSB+PWB" checked={psbPwbFilter} onChange={setPsbPwbFilter} />
                <CheckFilter label="Warranty" checked={bgFilter} onChange={setBgFilter} />
                <CheckFilter
                  label="RFP vetting"
                  checked={rfpVettingFilter}
                  onChange={setRfpVettingFilter}
                />
                <CheckFilter label="Refloat" checked={refloat} onChange={setRefloat} />
                <ThreeWayFilter
                  label="CNC"
                  value={cncPresenceFilter}
                  onChange={setCncPresenceFilter}
                />
                <CheckFilter label="TCEC" checked={tcec} onChange={setTcec} />
                <CheckFilter
                  label="Pre-Bid"
                  checked={preBidMeetingFilter}
                  onChange={setPreBidMeetingFilter}
                />
                <CheckFilter label="RST" checked={rstFilter} onChange={setRstFilter} />
              </div>
            </FilterGroup>

            <CollapsibleFilterGroup
              label="Demand & Control Dates"
              helper={searchFilterHelpers.demandControlDates}
              defaultOpen
            >
              <DateRangeFilter
                label="Demand Receipt Date"
                from={demandReceiptFrom}
                to={demandReceiptTo}
                onFromChange={setDemandReceiptFrom}
                onToChange={setDemandReceiptTo}
              />
              <DateRangeFilter
                label="Demand Control Date"
                from={demandControlFrom}
                to={demandControlTo}
                onFromChange={setDemandControlFrom}
                onToChange={setDemandControlTo}
              />
            </CollapsibleFilterGroup>

            <CollapsibleFilterGroup
              label="Approval & Committee Dates"
              helper={searchFilterHelpers.approvalDates}
            >
              <DateRangeFilter
                label="High Value Minutes Date"
                from={highValueMinutesFrom}
                to={highValueMinutesTo}
                onFromChange={setHighValueMinutesFrom}
                onToChange={setHighValueMinutesTo}
              />
              <DateRangeFilter
                label="Pre-TCEC date"
                from={preTcecDateFrom}
                to={preTcecDateTo}
                onFromChange={setPreTcecDateFrom}
                onToChange={setPreTcecDateTo}
              />
              <DateRangeFilter
                label="Pre-TCEC Minutes date"
                from={preTcecMinutesFrom}
                to={preTcecMinutesTo}
                onFromChange={setPreTcecMinutesFrom}
                onToChange={setPreTcecMinutesTo}
              />
              <FilterGroup
                label="Pre-TCEC committee"
                helper={searchFilterHelpers.tcecCommittee}
                active={Boolean(preTcecCommittee)}
              >
                <FilterSelect
                  value={preTcecCommittee}
                  onChange={setPreTcecCommittee}
                  options={preTcecCommitteeOptions}
                  placeholder="All Pre-TCEC committees"
                />
              </FilterGroup>
              <DateRangeFilter
                label="R&QA approval date"
                from={rqaApprovalFrom}
                to={rqaApprovalTo}
                onFromChange={setRqaApprovalFrom}
                onToChange={setRqaApprovalTo}
              />
              <DateRangeFilter
                label="IFA Final date"
                from={ifaFinalFrom}
                to={ifaFinalTo}
                onFromChange={setIfaFinalFrom}
                onToChange={setIfaFinalTo}
              />
              <DateRangeFilter
                label="CFA Approval Date"
                from={cfaApprovalFrom}
                to={cfaApprovalTo}
                onFromChange={setCfaApprovalFrom}
                onToChange={setCfaApprovalTo}
              />
              <DateRangeFilter
                label="Post-TCEC date"
                from={postTcecDateFrom}
                to={postTcecDateTo}
                onFromChange={setPostTcecDateFrom}
                onToChange={setPostTcecDateTo}
              />
              <DateRangeFilter
                label="Post-TCEC Minutes date"
                from={postTcecMinutesFrom}
                to={postTcecMinutesTo}
                onFromChange={setPostTcecMinutesFrom}
                onToChange={setPostTcecMinutesTo}
              />
              <FilterGroup
                label="Post-TCEC committee"
                helper={searchFilterHelpers.tcecCommittee}
                active={Boolean(postTcecCommittee)}
              >
                <FilterSelect
                  value={postTcecCommittee}
                  onChange={setPostTcecCommittee}
                  options={postTcecCommitteeOptions}
                  placeholder="All Post-TCEC committees"
                />
              </FilterGroup>
              <DateRangeFilter
                label="CNC Date"
                from={cncDateFrom}
                to={cncDateTo}
                onFromChange={setCncDateFrom}
                onToChange={setCncDateTo}
              />
              <DateRangeFilter
                label="Pre-Bid date"
                from={preBidDateFrom}
                to={preBidDateTo}
                onFromChange={setPreBidDateFrom}
                onToChange={setPreBidDateTo}
              />
              <DateRangeFilter
                label="Bidding date"
                from={biddingDateFrom}
                to={biddingDateTo}
                onFromChange={setBiddingDateFrom}
                onToChange={setBiddingDateTo}
              />
              <DateRangeFilter
                label="Bid opening date"
                from={bidOpeningDateFrom}
                to={bidOpeningDateTo}
                onFromChange={setBidOpeningDateFrom}
                onToChange={setBidOpeningDateTo}
              />
            </CollapsibleFilterGroup>

            <CollapsibleFilterGroup
              label="Supply Order & Delivery Dates"
              helper={searchFilterHelpers.supplyDeliveryDates}
            >
              <DateRangeFilter
                label="Financial Sanction date"
                from={financialSanctionFrom}
                to={financialSanctionTo}
                onFromChange={setFinancialSanctionFrom}
                onToChange={setFinancialSanctionTo}
              />
              <DateRangeFilter
                label="S.O. date"
                from={soDateFrom}
                to={soDateTo}
                onFromChange={setSoDateFrom}
                onToChange={setSoDateTo}
              />
              <DateRangeFilter
                label="D.P. period"
                helper={searchFilterHelpers.dpPeriod}
                from={dpFrom}
                to={dpTo}
                onFromChange={setDpFrom}
                onToChange={setDpTo}
              />
              <DateRangeFilter
                label="Material receipt date"
                from={materialReceiptFrom}
                to={materialReceiptTo}
                onFromChange={setMaterialReceiptFrom}
                onToChange={setMaterialReceiptTo}
              />
            </CollapsibleFilterGroup>

            <CollapsibleFilterGroup
              label="BG, Payment & Closure Dates"
              helper={searchFilterHelpers.bgPaymentClosureDates}
            >
              <DateRangeFilter
                label="BG received date"
                from={bgReceivedFrom}
                to={bgReceivedTo}
                onFromChange={setBgReceivedFrom}
                onToChange={setBgReceivedTo}
              />
              <DateRangeFilter
                label="BG validity date"
                from={bgValidityFrom}
                to={bgValidityTo}
                onFromChange={setBgValidityFrom}
                onToChange={setBgValidityTo}
              />
              <DateRangeFilter
                label="BG return date"
                from={bgReturnFrom}
                to={bgReturnTo}
                onFromChange={setBgReturnFrom}
                onToChange={setBgReturnTo}
              />
              <DateRangeFilter
                label="Bill sent/submitted date"
                from={billSubmittedFrom}
                to={billSubmittedTo}
                onFromChange={setBillSubmittedFrom}
                onToChange={setBillSubmittedTo}
              />
              <DateRangeFilter
                label="Payment date"
                from={paymentDateFrom}
                to={paymentDateTo}
                onFromChange={setPaymentDateFrom}
                onToChange={setPaymentDateTo}
              />
              <DateRangeFilter
                label="File Closure Date"
                from={fileClosureFrom}
                to={fileClosureTo}
                onFromChange={setFileClosureFrom}
                onToChange={setFileClosureTo}
              />
            </CollapsibleFilterGroup>

            <CollapsibleFilterGroup label="Firm" helper={searchFilterHelpers.firm}>
              <div className="grid grid-cols-2 gap-2">
                {firmSearchScopeOptions.map((scope) => (
                  <CheckFilter
                    key={scope.key}
                    label={scope.label}
                    checked={firmSearchScopes.includes(scope.key)}
                    onChange={(checked) => toggleFirmSearchScope(scope.key, checked)}
                    activeOverride={!sameStringList(firmSearchScopes, defaultFirmSearchScopes)}
                  />
                ))}
              </div>
              <FilterInput
                value={firm}
                onChange={setFirm}
                placeholder="Firm name"
                options={firmNameOptions}
              />
              <FilterInput
                value={firmUniqueNo}
                onChange={setFirmUniqueNo}
                placeholder="Firm Unique No."
                options={firmUniqueNoOptions}
              />
              <FilterInput
                value={firmContactNo}
                onChange={(value) => setFirmContactNo(value.replace(/\D/g, ""))}
                placeholder="Contact No."
                options={firmContactNoOptions}
              />
              <FilterInput
                value={firmCity}
                onChange={setFirmCity}
                placeholder="City"
                options={firmCityOptions}
              />
            </CollapsibleFilterGroup>

            <FilterGroup label="Free search date" helper={searchFilterHelpers.freeDate}>
              <FilterInput type="date" value={freeDate} onChange={setFreeDate} />
            </FilterGroup>

            <FilterGroup
              label="Closure & cancellation"
              helper={searchFilterHelpers.closureAndCancellation}
            >
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
                <ThreeWayFilter
                  label="File Closed"
                  value={fileClosedPresenceFilter}
                  onChange={setFileClosedPresenceFilter}
                />
                <ThreeWayFilter
                  label="Cancelled demand"
                  value={demandCancelledPresenceFilter}
                  onChange={setDemandCancelledPresenceFilter}
                />
                <ThreeWayFilter
                  label="Cancelled S.O."
                  value={soCancelledPresenceFilter}
                  onChange={setSoCancelledPresenceFilter}
                />
                <ThreeWayFilter
                  label="Shortclosed S.O."
                  value={shortclosedSoPresenceFilter}
                  onChange={setShortclosedSoPresenceFilter}
                />
              </div>
            </FilterGroup>

            <FilterGroup
              label="Special File Marker"
              helper={searchFilterHelpers.specialFileMarker}
              active={specialFileMarkers.length > 0}
            >
              <MultiSelectDropdown
                label="marker"
                options={(settings.specialFileMarkers ?? []).map((marker) => marker.code)}
                selectedValues={specialFileMarkers}
                onChange={setSpecialFileMarkers}
                allLabel="All markers"
              />
            </FilterGroup>
          </aside>
        ) : null}

        <section className="min-w-0 space-y-3">
          {showTableOptions && manualTableFieldsSelected && (
            <div className="ml-auto w-full max-w-5xl rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">Search table fields</h3>
                    <SearchHelper
                      items={searchFilterHelpers.requiredFields}
                      label="Column header checkbox help"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose which columns are visible in the search results table.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTableColumnKeys(printColumns.map((field) => field.key))
                    }
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={applyTableDefaultFields}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    My default
                  </button>
                  <button
                    type="button"
                    onClick={saveTableDefaultFields}
                    disabled={!tableDefaultChanged}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save default
                  </button>
                  <button
                    type="button"
                    onClick={clearTableDefaultFields}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Clear default
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTableColumnKeys([])}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {printColumnGroups.map((group) => (
                  <section
                    key={group.title}
                    className="rounded-md border border-border bg-secondary/20 p-3"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.columns.map((column) => (
                        <label
                          key={column.key}
                          className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTableColumnKeys.includes(column.key)}
                            onChange={() => toggleTableColumn(column.key)}
                            className="size-4 rounded border-input"
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          <div
            className="min-w-0 overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-card)]"
            data-testid="search-results"
          >
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ minWidth: Math.max(940, searchDisplayColumns.length * 150 + 380) }}
              >
                <thead className="bg-secondary text-sm text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleRowsSelected}
                        onChange={toggleVisibleRowsSelection}
                        aria-label="Select all visible files"
                        className="size-4 rounded border-input"
                      />
                    </th>
                    <th className="w-20 px-4 py-2.5 text-left font-bold">S. No.</th>
                    {searchDisplayColumns.map((displayColumn) => (
                      <th key={displayColumn.key} className="text-left font-bold px-4 py-2.5">
                        <div className="flex max-w-full flex-col gap-1.5">
                          <label
                            className={filterLabelClass(
                              Boolean(
                                displayColumn.sourceColumn &&
                                visibleRequiredFilledColumnKeys.includes(
                                  displayColumn.sourceColumn.key,
                                ),
                              ),
                              "inline-flex min-w-0 flex-1 items-center gap-2",
                            )}
                            title={
                              displayColumn.sourceColumn
                                ? `Show only rows where ${displayColumn.sourceColumn.label} is filled`
                                : displayColumn.label
                            }
                          >
                            {displayColumn.sourceColumn ? (
                              <input
                                type="checkbox"
                                checked={visibleRequiredFilledColumnKeys.includes(
                                  displayColumn.sourceColumn.key,
                                )}
                                onChange={() =>
                                  toggleRequiredFilledColumn(displayColumn.sourceColumn.key)
                                }
                                aria-label={`Require filled ${displayColumn.sourceColumn.label}`}
                                className="size-3.5 shrink-0 rounded border-input"
                              />
                            ) : null}
                            <span className="truncate">{displayColumn.label}</span>
                          </label>
                          {displayColumn.sourceColumn ? (
                            <div className="flex items-center gap-1 pl-5">
                              <button
                                type="button"
                                onClick={() =>
                                  setColumnHeaderSort(displayColumn.sourceColumn.key, "asc")
                                }
                                aria-label={`Sort ${displayColumn.sourceColumn.label} ascending`}
                                title={`Sort ${displayColumn.sourceColumn.label} ascending`}
                                className={
                                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition " +
                                  (activeSortColumnKey === displayColumn.sourceColumn.key &&
                                  sortDirection === "asc"
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                                }
                              >
                                <ArrowUp className="size-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setColumnHeaderSort(displayColumn.sourceColumn.key, "desc")
                                }
                                aria-label={`Sort ${displayColumn.sourceColumn.label} descending`}
                                title={`Sort ${displayColumn.sourceColumn.label} descending`}
                                className={
                                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition " +
                                  (activeSortColumnKey === displayColumn.sourceColumn.key &&
                                  sortDirection === "desc"
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                                }
                              >
                                <ArrowDown className="size-3" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </th>
                    ))}
                    <th className="text-right font-bold px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchTotal > 0 && (
                    <tr
                      className="border-t border-border bg-primary/5 text-xs font-semibold text-foreground transition-colors hover:bg-primary/10"
                      onClick={() => {
                        if (!summaryTotalsLockedOpen) setSummaryTotalsExpanded((open) => !open);
                      }}
                    >
                      <td className="w-12 px-4 py-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!summaryTotalsLockedOpen) setSummaryTotalsExpanded((open) => !open);
                          }}
                          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          aria-label={
                            summaryTotalsOpen ? "Collapse totals row" : "Expand totals row"
                          }
                          title={summaryTotalsOpen ? "Collapse totals row" : "Expand totals row"}
                        >
                          {summaryTotalsOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </td>
                      <td className="w-20 px-4 py-3 text-muted-foreground"></td>
                      {summaryTotalsOpen ? (
                        searchDisplayColumns.map((displayColumn, index) => (
                          <td key={displayColumn.key} className="max-w-[240px] px-4 py-3 align-top">
                            {index === 0 ? (
                              <span className="mb-1 block text-[10px] uppercase text-muted-foreground">
                                Total
                              </span>
                            ) : null}
                            {displayColumn.sourceColumn
                              ? formatSearchSummaryCell(
                                  displayColumn.sourceColumn,
                                  searchSummaryTotals,
                                )
                              : ""}
                          </td>
                        ))
                      ) : (
                        <td
                          colSpan={searchDisplayColumns.length}
                          className="px-4 py-3 text-muted-foreground"
                        >
                          Total row
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSummaryTotalsLockedOpen();
                          }}
                          className={
                            "inline-flex size-7 items-center justify-center rounded-md border transition " +
                            (summaryTotalsLockedOpen
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                          }
                          aria-label={
                            summaryTotalsLockedOpen ? "Unlock totals row" : "Lock totals row open"
                          }
                          title={
                            summaryTotalsLockedOpen ? "Unlock totals row" : "Lock totals row open"
                          }
                        >
                          {summaryTotalsLockedOpen ? (
                            <Lock className="size-4" />
                          ) : (
                            <Unlock className="size-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  )}
                  {results.length === 0 && (
                    <tr>
                      <td
                        colSpan={searchDisplayColumns.length + 3}
                        className="text-center text-sm text-muted-foreground py-10"
                      >
                        No files match your filters.
                      </td>
                    </tr>
                  )}
                  {searchDisplayRows.map((row, index) => (
                    <tr
                      key={row.key}
                      onClick={() => openTimeline(row.file)}
                      data-testid={
                        row.isFirstFileRow
                          ? `search-result-${testIdSlug(
                              row.file.uniqueCode || row.file.fileNo || row.file.id,
                            )}`
                          : undefined
                      }
                      className={
                        "border-t border-border cursor-pointer transition-colors hover:bg-accent/60 " +
                        (row.isDetailRow
                          ? "bg-secondary/20"
                          : index % 2 === 0
                            ? "bg-card"
                            : "bg-secondary/40")
                      }
                    >
                      <td className="w-12 px-4 py-3">
                        {row.isFirstFileRow ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedFileIds.includes(row.file.id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleFileSelection(row.file.id)}
                              aria-label={`Select ${
                                row.file.uniqueCode || row.file.imms || row.file.id
                              }`}
                              className="size-4 rounded border-input"
                            />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSearchFileExpansion(row.file.id);
                              }}
                              disabled={!hasDetailedSearchRows(row.file)}
                              aria-label={
                                row.expanded ? "Collapse file details" : "Expand file details"
                              }
                              title={row.expanded ? "Collapse file details" : "Expand file details"}
                              className="inline-flex size-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {row.expanded ? (
                                <ChevronDown className="size-3.5" />
                              ) : (
                                <ChevronRight className="size-3.5" />
                              )}
                            </button>
                          </div>
                        ) : null}
                      </td>
                      <td className="w-20 px-4 py-3 text-sm font-semibold tabular-nums text-foreground">
                        {row.isFirstFileRow ? row.serialNumber : ""}
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.key}
                          className="max-w-[240px] align-top px-4 py-3 text-muted-foreground"
                        >
                          <div className="max-h-24 overflow-y-auto whitespace-pre-line pr-1 leading-5">
                            {cell.value}
                          </div>
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right">
                        {row.isFirstFileRow ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                printVisibleFile(row.file, selectedTableColumns);
                              }}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-card text-foreground hover:bg-accent"
                            >
                              <Printer className="size-3.5" /> Print
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                printFile(row.file);
                              }}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-card text-foreground hover:bg-accent"
                            >
                              <Printer className="size-3.5" /> Print timeline
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Filter className="size-3.5" />
                <span className="font-medium text-foreground">{searchTotal}</span> result
                {searchTotal !== 1 && "s"}
              </span>
              <span>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {firstResultNumber}-{lastResultNumber}
                </span>
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {renderPaginationControls()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const searchSummaryAmountKeys = new Set<string>([
  "valueCapital",
  "valueRevenue",
  "soValueCapital",
  "soValueRevenue",
  "psbBgAmount",
  "pwbBgAmount",
  "combinedBgAmount",
  "actualPaymentCapital",
  "actualPaymentRevenue",
  "stageAmountCapital",
  "stageAmountRevenue",
  "advanceStageAmountCapital",
  "advanceStageAmountRevenue",
  "advanceActualPaymentCapital",
  "advanceActualPaymentRevenue",
]);

const searchSummaryCountKeys = new Set<string>([
  "noOfSo",
  "dpExtensionCount",
  "stageDeliveryCount",
]);

function formatSearchSummaryCell(column: PrintColumn, totals: Record<string, number>) {
  const value = totals[column.key];
  if (value === undefined) return "-";
  if (searchSummaryAmountKeys.has(column.key)) return formatCurrency(value);
  if (searchSummaryCountKeys.has(column.key)) return Math.round(value).toLocaleString("en-IN");
  return "-";
}

type SearchDisplayColumn = {
  key: string;
  label: string;
  sourceColumn?: PrintColumn;
  valueIndex: number;
};

type SearchDisplayRow = {
  key: string;
  file: FileRecord;
  serialNumber: number;
  expanded: boolean;
  isFirstFileRow: boolean;
  isDetailRow: boolean;
  cells: Array<{ key: string; value: string }>;
};

function buildSearchDisplayColumns(columns: PrintColumn[]): SearchDisplayColumn[] {
  return columns.flatMap((column) => {
    if (!isSupplyOrderKey(column.key)) {
      return [{ key: column.key, label: column.label, sourceColumn: column, valueIndex: 0 }];
    }
    return getRowwiseSupplyOrderExportHeaders(column).map((label, valueIndex) => ({
      key: valueIndex === 0 ? column.key : `${column.key}:${valueIndex}`,
      label,
      sourceColumn: column,
      valueIndex,
    }));
  });
}

function buildSearchDisplayRows(
  files: FileRecord[],
  columns: PrintColumn[],
  expandedFileIds: Set<string>,
  startSerialNumber = 1,
): SearchDisplayRow[] {
  const displayColumns = buildSearchDisplayColumns(columns);
  return files.flatMap((file, fileIndex) => {
    const expanded = expandedFileIds.has(file.id);
    const serialNumber = startSerialNumber + fileIndex;
    if (!expanded) {
      return [
        {
          key: `${file.id}:summary`,
          file,
          serialNumber,
          expanded,
          isFirstFileRow: true,
          isDetailRow: false,
          cells: displayColumns.map((displayColumn) => ({
            key: displayColumn.key,
            value: getCompactSearchDisplayValue(file, displayColumn),
          })),
        },
      ];
    }

    return getRowwiseSearchExportEntries(file, columns).map((entry, entryIndex) => ({
      key: `${file.id}:detail:${entryIndex}`,
      file,
      serialNumber,
      expanded,
      isFirstFileRow: entryIndex === 0,
      isDetailRow: true,
      cells: displayColumns.map((displayColumn) => ({
        key: displayColumn.key,
        value: getDetailedSearchDisplayValue(file, displayColumn, entry, entryIndex),
      })),
    }));
  });
}

function getCompactSearchDisplayValue(file: FileRecord, displayColumn: SearchDisplayColumn) {
  const column = displayColumn.sourceColumn;
  if (!column) return "";
  if (displayColumn.valueIndex > 0) return "";
  return column.getValue(file) || "";
}

function getDetailedSearchDisplayValue(
  file: FileRecord,
  displayColumn: SearchDisplayColumn,
  entry: RowwiseSearchExportEntry,
  entryIndex: number,
) {
  const column = displayColumn.sourceColumn;
  if (!column) return "";
  if (!isSupplyOrderKey(column.key)) return entryIndex === 0 ? column.getValue(file) || "" : "";
  const values = getRowwiseSupplyOrderExportValues(file, column.key, entry);
  return String(values[displayColumn.valueIndex] ?? "");
}

function hasDetailedSearchRows(file: FileRecord) {
  return rawSupplyOrders(file).some((order) => {
    const stages = isYes(order.stageDelivery) ? (order.stageDeliveries?.length ?? 0) : 0;
    const billReturns = normalizeBillReturnCycles(order.billReturnCycles).length;
    const supplementaryBills = normalizeSupplementaryBillsForTable(order.supplementaryBills).length;
    return stages > 0 || billReturns > 0 || supplementaryBills > 0;
  });
}

function DrillPathTrail({
  items,
  fallbackHref,
}: {
  items: DrillPathItem[];
  fallbackHref?: string;
}) {
  if (!items.length) return null;
  return (
    <nav
      aria-label="Dashboard drill path"
      className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
    >
      {items.map((item, index) => {
        const href = item.href ?? fallbackHref;
        const labelClassName =
          "rounded px-1 py-0.5 transition " +
          (index === items.length - 1
            ? "font-medium text-foreground"
            : "hover:bg-accent hover:text-foreground");
        return (
          <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3" aria-hidden="true" /> : null}
            {href ? (
              <a href={href} className={labelClassName}>
                {item.label}
              </a>
            ) : (
              <span className={labelClassName}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function testIdSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function SearchPaginationControls({
  currentPage,
  totalPages,
  loading,
  onPrevious,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="inline-flex h-8 overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={onPrevious}
        disabled={currentPage <= 1 || loading}
        className="px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
      >
        Previous
      </button>
      <div className="flex items-center border-x border-border px-2.5 text-xs text-muted-foreground">
        Page <span className="ml-1 font-medium text-foreground">{currentPage}</span>
        <span className="mx-1">of</span>
        <span className="font-medium text-foreground">{totalPages}</span>
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={currentPage >= totalPages || loading}
        className="px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
      >
        Next
      </button>
    </div>
  );
}

function FilterGroup({
  label,
  helper,
  active = false,
  children,
}: {
  label: string;
  helper?: string[];
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <HelperLabel label={label} helper={helper} active={active} />
      {children}
    </div>
  );
}

function CollapsibleFilterGroup({
  label,
  helper,
  children,
  defaultOpen = false,
}: {
  label: string;
  helper?: string[];
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-md border border-border bg-background/40 shadow-sm"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground outline-none hover:text-foreground">
        <span className="inline-flex items-center gap-1.5">
          {label}
          {helper ? <SearchHelper items={helper} label={`${label} help`} /> : null}
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">{children}</div>
    </details>
  );
}

function DateRangeFilter({
  label,
  helper,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  label: string;
  helper?: string[];
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const active = Boolean(from || to);
  return (
    <FilterGroup label={label} helper={helper} active={active}>
      <div className="grid grid-cols-2 gap-2">
        <FilterInput type="date" value={from} onChange={onFromChange} />
        <FilterInput type="date" value={to} onChange={onToChange} />
      </div>
    </FilterGroup>
  );
}

function HelperLabel({
  label,
  helper,
  active = false,
}: {
  label: string;
  helper?: string[];
  active?: boolean;
}) {
  return (
    <div
      className={filterLabelClass(
        active,
        "mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
      )}
    >
      {label}
      {helper ? <SearchHelper items={helper} label={`${label} help`} /> : null}
    </div>
  );
}

function SearchHelper({ items, label }: { items: string[]; label: string }) {
  const bullets = splitHelperText(items);
  const examples = searchFilterExamples[label];
  const [showExamples, setShowExamples] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(event) => event.preventDefault()}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <CircleHelp className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          className="max-w-[44rem] text-xs leading-relaxed"
        >
          <div
            className={
              showExamples
                ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]"
                : "space-y-3"
            }
          >
            <div className="space-y-3">
              <ul className="list-disc space-y-1 pl-4">
                {bullets.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              {examples ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowExamples((current) => !current)}
                    className="rounded border border-primary/40 bg-background px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                    aria-expanded={showExamples}
                  >
                    {showExamples ? "Hide examples" : "Examples"}
                  </button>
                </div>
              ) : null}
            </div>
            {examples && showExamples ? (
              <div className="rounded-md border border-border bg-background p-3 text-popover-foreground shadow-sm">
                <div className="mb-2 font-semibold">{examples.title}</div>
                <ul className="list-disc space-y-1 pl-4">
                  {splitHelperText(examples.items).map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function splitHelperText(items: string[]) {
  return items
    .flatMap((item) => protectHelperAbbreviations(item).split("\n"))
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((item) =>
      restoreHelperAbbreviations(item)
        .trim()
        .replace(/^[-*]\s+/, ""),
    )
    .filter(Boolean);
}

function protectHelperAbbreviations(text: string) {
  return text
    .replaceAll("S.O.", "S§O§")
    .replaceAll("D.P.", "D§P§")
    .replaceAll("F.Y.", "F§Y§")
    .replaceAll("FY.", "FY§")
    .replaceAll("No.", "No§");
}

function restoreHelperAbbreviations(text: string) {
  return text
    .replaceAll("S§O§", "S.O.")
    .replaceAll("D§P§", "D.P.")
    .replaceAll("F§Y§", "F.Y.")
    .replaceAll("FY§", "FY.")
    .replaceAll("No§", "No.");
}

function FilterInput({
  value,
  onChange,
  placeholder,
  type = "text",
  decimalOnly = false,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  decimalOnly?: boolean;
  options?: string[];
}) {
  const active = Boolean(value);
  if (type === "date") {
    return (
      <DateInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={filterControlClass(
          active,
          "w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm",
        )}
      />
    );
  }
  if (options?.length) {
    return (
      <SearchableDropdown
        value={value}
        onChange={(next) => onChange(decimalOnly ? formatDecimalInput(next) : next)}
        options={options}
        placeholder={placeholder}
        className={filterControlClass(
          active,
          "w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm",
        )}
      />
    );
  }
  return (
    <input
      type={type}
      inputMode={decimalOnly ? "decimal" : undefined}
      value={value}
      onChange={(event) =>
        onChange(decimalOnly ? formatDecimalInput(event.target.value) : event.target.value)
      }
      placeholder={placeholder}
      className={filterControlClass(
        active,
        "w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm",
      )}
    />
  );
}

function formatDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  const decimalPart = rest.join("");
  const formattedInteger = formatInputThousandsAndLakhs(first);
  return rest.length > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

function clampDateYearInput(value: string) {
  const [year = "", ...rest] = value.split("-");
  if (year.length <= 4) return value;
  return [year.slice(0, 4), ...rest].join("-");
}

function formatInputThousandsAndLakhs(integerPart: string) {
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) return integerPart;

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  const active = Boolean(value);
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={filterControlClass(
        active,
        "w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm",
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  allLabel,
}: {
  label: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  allLabel: string;
}) {
  const selectedSet = new Set(selectedValues);
  const toggle = (value: string) => {
    onChange(
      selectedSet.has(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value],
    );
  };
  const clear = () => onChange([]);
  const selectedLabel =
    selectedValues.length === 0
      ? allLabel
      : selectedValues.length === 1
        ? selectedValues[0]
        : `${selectedValues.length} ${label}s selected`;
  return (
    <details
      className={filterControlClass(
        selectedValues.length > 0,
        "group relative rounded-md border border-input bg-background text-sm",
      )}
    >
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 [&::-webkit-details-marker]:hidden">
        <span className="truncate">{selectedLabel}</span>
        <span className="text-xs text-muted-foreground group-open:hidden">Select</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">Close</span>
      </summary>
      <div className="absolute z-30 mt-1 w-full min-w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
        <button
          type="button"
          onClick={clear}
          className="mb-2 h-8 w-full rounded-md border border-border px-2 text-left text-xs font-medium hover:bg-accent"
        >
          {allLabel}
        </button>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {options.length ? (
            options.map((option) => (
              <label
                key={option}
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 text-xs hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(option)}
                  onChange={() => toggle(option)}
                  className="size-4 rounded border-input"
                />
                <span className="truncate">{option}</span>
              </label>
            ))
          ) : (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No {label}s configured.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function CheckFilter({
  label,
  checked,
  onChange,
  activeOverride,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  activeOverride?: boolean;
}) {
  const active = activeOverride ?? checked;
  return (
    <label
      className={filterControlClass(
        active,
        "flex items-center gap-2 text-sm cursor-pointer rounded-md border border-border bg-background px-2.5 py-2",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-input"
      />
      <span className={filterLabelClass(active, "")}>{label}</span>
    </label>
  );
}

function ThreeWayFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: IncludeExcludeFilter;
  onChange: (value: IncludeExcludeFilter) => void;
}) {
  const active = value !== "none";
  const options: Array<{ value: IncludeExcludeFilter; label: string }> = [
    { value: "none", label: "None" },
    { value: "include", label: "Only" },
    { value: "exclude", label: "Exclude" },
  ];
  return (
    <div
      className={filterControlClass(
        active,
        "rounded-md border border-border bg-background p-2 text-sm",
      )}
    >
      <div className={filterLabelClass(active, "mb-1.5 text-xs font-medium")}>{label}</div>
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={
                "h-8 border-r border-border px-2 text-xs last:border-r-0 " +
                (selected
                  ? option.value === "none"
                    ? "bg-secondary font-semibold text-foreground"
                    : option.value === "include"
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-destructive text-destructive-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-accent")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function updateSingleOnlyMultiExcludeFilter(
  current: Record<string, IncludeExcludeFilter>,
  key: string,
  value: IncludeExcludeFilter,
) {
  const next = { ...current };
  if (value === "none") {
    delete next[key];
    return next;
  }
  if (value === "include") {
    Object.entries(next).forEach(([itemKey, itemValue]) => {
      if (itemKey !== key && itemValue === "include") delete next[itemKey];
    });
  }
  next[key] = value;
  return next;
}

function normalizeSingleOnlyMultiExcludeFilters(current: Record<string, IncludeExcludeFilter>) {
  let foundOnly = false;
  let changed = false;
  const next: Record<string, IncludeExcludeFilter> = {};
  Object.entries(current).forEach(([key, value]) => {
    if (value === "none") {
      changed = true;
      return;
    }
    if (value === "include") {
      if (foundOnly) {
        changed = true;
        return;
      }
      foundOnly = true;
    }
    next[key] = value;
  });
  return changed ? next : current;
}

function EditModal({
  file,
  onClose,
  divisions,
}: {
  file: FileRecord;
  onClose: () => void;
  divisions: string[];
}) {
  const settings = useSettings();
  const navigate = useNavigate();
  const editFieldSections = fieldSections
    .map((section) => ({
      ...section,
      fields: section.fields.filter(
        (field): field is FieldDef & { key: FileKey } =>
          field.key !== "noOfSo" && !isSupplyOrderKey(field.key),
      ),
    }))
    .filter((section) => section.fields.length > 0);
  const [form, setForm] = useState<Record<FileKey, string>>(() => {
    const entries = editFieldSections
      .flatMap((section) => section.fields)
      .map((field) => [field.key, String(file[field.key] ?? getDefaultFieldValue(field.key))]);
    return applyConditionalRules({
      ...(Object.fromEntries(entries) as Record<FileKey, string>),
      year: settings.financialYear,
    });
  });
  const originalForm = useMemo(() => {
    const entries = editFieldSections
      .flatMap((section) => section.fields)
      .map((field) => [field.key, String(file[field.key] ?? getDefaultFieldValue(field.key))]);
    return applyConditionalRules({
      ...(Object.fromEntries(entries) as Record<FileKey, string>),
      year: settings.financialYear,
    });
  }, [editFieldSections, file, settings.financialYear]);

  const formWithLockedYear = { ...form, year: settings.financialYear };
  const formDirty = !isSearchDirtyValueEqual(
    toFilePatch(applyConditionalRules(formWithLockedYear)),
    toFilePatch(applyConditionalRules(originalForm)),
  );
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const gemIsNo = isNo(formWithLockedYear.gem);
  const highValueIsNo = isNo(formWithLockedYear.highValue);
  const rqaIsNo = isNo(formWithLockedYear.rqa);
  const ifaIsNo = isNo(formWithLockedYear.ifa);
  const bgIsNo = isNo(formWithLockedYear.bg);
  const irIsNo = isNo(formWithLockedYear.ir);
  const rfpVettingIsNo = isNo(formWithLockedYear.rfpVetting);
  const preBidMeetingIsNo = isNo(formWithLockedYear.preBidMeeting);
  const refloatIsNo = isNo(formWithLockedYear.refloat);
  const refloatPreBidMeetingIsNo = isNo(formWithLockedYear.refloatPreBidMeeting);
  const update = (key: FileKey, value: string) => {
    if (key === "year") return;
    setForm((current) => {
      const patch: Partial<Record<FileKey, string>> = { [key]: value };
      if (key === "valueCapital" && hasNonZeroAmount(value)) {
        patch.valueRevenue = "";
      }
      if (key === "valueRevenue" && hasNonZeroAmount(value)) {
        patch.valueCapital = "";
      }
      if (key === "soValueCapital" && hasNonZeroAmount(value)) {
        patch.soValueRevenue = "";
      }
      if (key === "soValueRevenue" && hasNonZeroAmount(value)) {
        patch.soValueCapital = "";
      }
      if (key === "currency" && isInr(value)) {
        patch.exchangeRate = "1";
      }
      if (key === "refloat" && isYes(value)) {
        patch.biddingStageOver = "No";
      }
      if (key === "gem" && isYes(value)) {
        patch.paymentMode = "Online";
      }
      if (key === "ir" && isNo(value)) {
        patch.irPreparationDate = "";
        patch.irReceiptDate = "";
      }
      return applyConditionalRules({ ...current, ...patch });
    });
  };

  const save = () => {
    if (!formDirty) return;
    const patch = toFilePatch(applyConditionalRules(formWithLockedYear));
    const nextFile = { ...file, ...patch };
    const milestoneErrors = validateMilestoneCompletionConsistency(
      nextFile,
      getConfiguredMilestones(settings.milestones),
    );
    if (milestoneErrors.length) {
      alert(["Please fix milestone status before saving:", ...milestoneErrors].join("\n"));
      navigate({
        to: "/add",
        search: {
          fileId: file.id,
          section: "Milestones",
          milestone: getMilestoneValidationTarget(
            milestoneErrors,
            getConfiguredMilestones(settings.milestones),
          ),
          quickFocus: false,
        },
      });
      return;
    }
    store.updateFile(file.id, patch);
    onClose();
  };

  const del = async () => {
    const label = file.uniqueCode || file.imms || file.demandDescription || "this file";
    const deletionPassword = await promptDeletionPassword(`delete ${label}`);
    if (deletionPassword === null) return;
    store.deleteFile(file.id, deletionPassword);
    onClose();
  };

  return (
    <ModalShell title="File details" onClose={onClose}>
      <p className="mb-4 text-xs text-black">Click Save to save, else data will be lost.</p>
      <div className="space-y-6">
        {editFieldSections
          .filter(
            (section) =>
              isBiddingApplicableForFile(formWithLockedYear) ||
              (isYes(formWithLockedYear.gem) &&
                formWithLockedYear.gemBiddingMode === "Comparison" &&
                section.title === "Bidding details") ||
              section.title !== "Bidding details",
          )
          .map((section) => (
            <section key={section.title}>
              <h4 className="text-sm font-semibold border-b border-border pb-2 mb-4">
                {section.title}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {section.fields.map((field) => {
                  if (
                    section.title === "Bidding details" &&
                    !isBiddingApplicableForFile(formWithLockedYear) &&
                    field.key !== "gemBiddingMode"
                  ) {
                    return null;
                  }
                  const renderedField =
                    field.key === "division"
                      ? { ...field, options: divisions }
                      : tcecCommitteeKeys.includes(field.key)
                        ? {
                            ...field,
                            options: getTcecCommitteeOptions(
                              settings.tcecCommittees,
                              formWithLockedYear[field.key],
                            ),
                          }
                        : field;
                  return (
                    <EditField
                      key={field.key}
                      field={renderedField}
                      value={formWithLockedYear[field.key]}
                      disabled={
                        field.key === "year" ||
                        field.key === "tenderLive" ||
                        (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
                        (gemIsNo && gemDisabledKeys.includes(field.key)) ||
                        (highValueIsNo && highValueDisabledKeys.includes(field.key)) ||
                        (rqaIsNo && rqaDisabledKeys.includes(field.key)) ||
                        (ifaIsNo && ifaDisabledKeys.includes(field.key)) ||
                        (bgIsNo && bgDisabledKeys.includes(field.key)) ||
                        (irIsNo && irDisabledKeys.includes(field.key)) ||
                        (rfpVettingIsNo && rfpVettingDisabledKeys.includes(field.key)) ||
                        (preBidMeetingIsNo && preBidMeetingDisabledKeys.includes(field.key)) ||
                        (!isYes(formWithLockedYear.biddingStageOver) &&
                          biddingStageOverDisabledKeys.includes(field.key)) ||
                        (refloatIsNo && refloatDisabledKeys.includes(field.key)) ||
                        (refloatPreBidMeetingIsNo &&
                          refloatPreBidMeetingDisabledKeys.includes(field.key))
                      }
                      onChange={(value) => update(field.key, value)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
      </div>
      <div className="mt-6 flex justify-between">
        <button onClick={del} className="text-xs text-destructive hover:underline">
          Delete file
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!formDirty}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-[var(--shadow-elevated)] w-full max-w-6xl max-h-[90vh] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="size-7 grid place-items-center rounded-md hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-4rem)]">{children}</div>
      </div>
    </div>
  );
}

function EditField({
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: FieldDef;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const amountField = isAmountField(field.key);

  if (field.options && isYesNoOptions(field.options)) {
    return (
      <div className="block">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <div className={`grid grid-cols-2 gap-2 ${disabledCls(disabled)}`}>
          {field.options.map((option) => (
            <label
              key={option}
              className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
            >
              <input
                type="radio"
                name={field.key}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(option)}
                className="size-4 border-input"
              />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.options) {
    return (
      <label className="block">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={editInputCls + disabledCls(disabled)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block md:col-span-2 xl:col-span-3">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={
            "w-full min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y" +
            disabledCls(disabled)
          }
        />
      </label>
    );
  }

  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{field.label}</div>
      {field.type === "date" ? (
        <DateInput
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={editInputCls + disabledCls(disabled)}
        />
      ) : (
        <input
          type={amountField ? "text" : (field.type ?? "text")}
          value={value}
          onChange={(event) =>
            onChange(amountField ? formatDecimalInput(event.target.value) : event.target.value)
          }
          disabled={disabled}
          min={field.type === "number" ? 0 : undefined}
          step={field.type === "number" ? 1 : undefined}
          inputMode={amountField ? "decimal" : undefined}
          className={editInputCls + disabledCls(disabled)}
        />
      )}
    </label>
  );
}

const editInputCls =
  "w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40";

function toFilePatch(form: Record<FileKey, string>) {
  return Object.fromEntries(
    editableFileFields.map((field) => [field.key, form[field.key] || undefined]),
  ) as Partial<FileRecord>;
}

function isSearchDirtyValueEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getDefaultFieldValue(key: FileKey) {
  if (key === "currency") return "INR";
  return defaultNoKeys.includes(key) ? "No" : "";
}

function applyConditionalRules(form: Record<FileKey, string>) {
  let next = form;
  if (!isBiddingApplicableForFile(next)) {
    next = {
      ...next,
      gemUndertakingDate:
        isYes(next.gem) && next.gemBiddingMode === "Comparison" ? next.gemUndertakingDate : "",
      rfpVetting: "No",
      rfpVettingInitiationDate: "",
      rfpVettingApprovalDate: "",
      preBidMeeting: "No",
      preBidMeetingDate: "",
      bidNumber: "",
      bidDate: "",
      bidOpeningDate: "",
      tenderLive: "No",
      bidOpened: "NO",
      refloat: "No",
      refloatPreBidMeeting: "No",
      refloatPreBidMeetingDate: "",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
      rst: "No",
      biddingStageOver: "No",
    };
  }
  if (isInr(next.currency) && !next.exchangeRate) {
    next = {
      ...next,
      exchangeRate: "1",
    };
  }
  if (hasNonZeroAmount(next.valueCapital)) {
    next = {
      ...next,
      valueRevenue: "",
    };
  } else if (hasNonZeroAmount(next.valueRevenue)) {
    next = {
      ...next,
      valueCapital: "",
    };
  }
  if (hasNonZeroAmount(next.soValueCapital)) {
    next = {
      ...next,
      soValueRevenue: "",
    };
  } else if (hasNonZeroAmount(next.soValueRevenue)) {
    next = {
      ...next,
      soValueCapital: "",
    };
  }
  if (isNo(next.tcec)) {
    next = {
      ...next,
      highValueMeetingDate: "",
      highValueMinutesDate: "",
      preTcecDate: "",
      preTcecMinutesDate: "",
      preTcecCommitteeNo: "",
      ad: "No",
      adVettingDate: "",
      postTcecDate: "",
      postTcecMinutesDate: "",
      postTcecCommitteeNumber: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
      cncDate: "",
      cncApprovalDate: "",
    };
  }
  if (isNo(next.gem)) {
    next = {
      ...next,
      gemUndertakingDate: "",
      gemSoNo: "",
    };
  }
  if (isNo(next.highValue)) {
    next = {
      ...next,
      highValueMeetingDate: "",
      highValueMinutesDate: "",
    };
  }
  if (isYes(next.gem) && !next.paymentMode) {
    next = {
      ...next,
      paymentMode: "Online",
    };
  }
  if (isNo(next.rqa)) {
    next = {
      ...next,
      rqaApprovalDate: "",
    };
  }
  if (isNo(next.ifa)) {
    next = {
      ...next,
      ifaSentDate: "",
      ifaFinalDate: "",
    };
  }
  if (isNo(next.bg)) {
    next = {
      ...next,
      pwbBgNo: "",
      pwbBgAmount: "",
      pwbBgReceivedDate: "",
      pwbBgValidityDate: "",
      pwbBgReturnDate: "",
      combinedBgNo: "",
      combinedBgAmount: "",
      combinedBgReceivedDate: "",
      combinedBgValidityDate: "",
      combinedBgReturnDate: "",
      warrantyPeriodDate: "",
    };
  }
  if (isNo(next.ir)) {
    next = {
      ...next,
      irPreparationDate: "",
      irReceiptDate: "",
    };
  }
  if (isNo(next.rfpVetting)) {
    next = {
      ...next,
      rfpVettingInitiationDate: "",
      rfpVettingApprovalDate: "",
    };
  }
  if (isNo(next.preBidMeeting)) {
    next = {
      ...next,
      preBidMeetingDate: "",
    };
  }
  if (isNo(next.refloat)) {
    next = {
      ...next,
      refloatPreBidMeeting: "No",
      refloatPreBidMeetingDate: "",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
    };
  }
  if (isNo(next.refloatPreBidMeeting)) {
    next = {
      ...next,
      refloatPreBidMeetingDate: "",
    };
  }
  if (isYes(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount),
    };
  }
  if (isNo(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: "",
    };
  }
  next = {
    ...next,
    tenderLive: getAutoTenderLive(next),
  };
  if (isYes(next.tenderLive)) {
    next = {
      ...next,
      bidOpened: "NO",
    };
  }
  return next;
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function getInitialExtensionCount(value: string | undefined) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? (value ?? "") : "1";
}

function getAutoTenderLive(form: Record<FileKey, string>) {
  if (hasDate(form.refloatBiddingDate) && hasDate(form.refloatBidOpeningDate)) {
    return isTenderLiveOnCalendarDate(form.refloatBiddingDate, form.refloatBidOpeningDate)
      ? "Yes"
      : "No";
  }

  return isTenderLiveOnCalendarDate(form.bidDate, form.bidOpeningDate) ? "Yes" : "No";
}

function isTenderLiveOnCalendarDate(
  bidDate: string | undefined,
  bidOpeningDate: string | undefined,
) {
  const bidTime = parseLocalDateTime(bidDate ?? "");
  const openingTime = parseLocalDateTime(bidOpeningDate ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (bidTime === undefined || openingTime === undefined || todayTime === undefined) {
    return false;
  }

  return bidTime <= todayTime && todayTime <= openingTime;
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

function disabledCls(disabled: boolean) {
  return disabled ? " opacity-60 cursor-not-allowed" : "";
}

function isYesNoOptions(options: string[]) {
  return (
    options.length === 2 && options[0].toLowerCase() === "yes" && options[1].toLowerCase() === "no"
  );
}

function includesText(value: string | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function normalizeFirmRows(rows: FirmDetail[] | undefined) {
  return (
    rows
      ?.map((row) => ({
        firmName: row.firmName?.trim() || "",
        city: row.city?.trim() || "",
        emailId: row.emailId?.trim() || "",
      }))
      .filter((row) => row.firmName || row.city || row.emailId) ?? []
  );
}

function getFirmCount(rows: FirmDetail[] | undefined) {
  return normalizeFirmRows(rows).length;
}

function getTcecCommitteeOptions(committees: string[] | undefined, currentValue: string) {
  const values = (committees ?? []).filter(Boolean);
  return currentValue && !values.includes(currentValue) ? [...values, currentValue] : values;
}

function matchesFirmCount(rows: FirmDetail[] | undefined, query: string) {
  const expected = Number.parseInt(query, 10);
  if (!Number.isFinite(expected)) return true;
  return getFirmCount(rows) === expected;
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function isInr(value: string | undefined) {
  return (value ?? "").trim().toUpperCase() === "INR";
}

function hasNonZeroAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return false;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount !== 0;
}

function fileSupplyOrders(file: FileRecord) {
  return normalizedFileSupplyOrders(file);
}

function filePaymentOrders(file: FileRecord) {
  return normalizedFilePaymentOrders(file);
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

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function getSupplyOrderFieldValue(file: FileRecord, key: SupplyOrderKey) {
  const rows = getSupplyOrderRowsForTableField(file, key);
  return rows
    .map((order, index) => {
      const value = getSupplyOrderValue(order, key);
      if (!value.trim()) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("\n");
}

function getSupplyOrderRowsForTableField(file: FileRecord, key: SupplyOrderKey) {
  if (stagedDeliveryWorkflowKeys.has(key)) return fileSupplyOrders(file);
  if (stagedPaymentWorkflowKeys.has(key) || isAdvancePaymentDetailField(key)) {
    return filePaymentOrders(file);
  }
  return rawSupplyOrders(file);
}

function getSupplyOrderCurrentMilestoneValue(file: FileRecord) {
  return rawSupplyOrders(file)
    .map((order, index, rows) => {
      const value = String(order.currentMilestone ?? "").trim();
      if (!value) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function getSupplyOrderValue(order: SupplyOrderDetail, key: SupplyOrderKey) {
  if (key === "billReturnCycles") return formatBillReturnCycles(order.billReturnCycles);
  const supplementaryValue = getSupplementaryBillTableValue(order.supplementaryBills, key);
  if (supplementaryValue !== undefined) return supplementaryValue;
  if (key === "soValueCapital" || key === "soValueRevenue") {
    return getSupplyOrderAmountFieldValue(order, key);
  }
  if (key === "stageAmountCapital") {
    return order.stageDeliveryLabel ? getSupplyOrderAmountFieldValue(order, "soValueCapital") : "";
  }
  if (key === "stageAmountRevenue") {
    return order.stageDeliveryLabel ? getSupplyOrderAmountFieldValue(order, "soValueRevenue") : "";
  }
  const advanceValue = getAdvancePaymentDetailValue(order, key);
  const value = advanceValue !== undefined ? advanceValue : String(order[key] ?? "");
  return isSupplyOrderDateField(key) ? formatIsoDateForDisplay(value) : value;
}

function formatBillReturnCycles(cycles: BillReturnCycle[] | undefined) {
  return normalizeBillReturnCycles(cycles)
    .map((cycle, index, rows) => {
      const parts = [
        cycle.returnedDate ? `Returned: ${formatIsoDateForDisplay(cycle.returnedDate)}` : "",
        cycle.resubmittedDate
          ? `Resubmitted: ${formatIsoDateForDisplay(cycle.resubmittedDate)}`
          : "",
        cycle.reason ? `Reason: ${cycle.reason}` : "",
        cycle.remarks ? `Remarks: ${cycle.remarks}` : "",
      ].filter(Boolean);
      if (!parts.length) return "";
      return rows.length > 1 ? `${index + 1}. ${parts.join("; ")}` : parts.join("; ");
    })
    .filter(Boolean)
    .join("\n");
}

function getSupplementaryBillTableValue(
  bills: SupplementaryBillDetail[] | undefined,
  key: SupplyOrderKey,
) {
  const rows = normalizeSupplementaryBillsForTable(bills);
  if (key === "supplementaryBills") return formatSupplementaryBills(rows);
  if (key === "supplementaryBillNo") return formatSupplementaryBillField(rows, "billNo");
  if (key === "supplementaryBillAmountCapital") {
    return formatSupplementaryBillField(rows, "billAmountCapital");
  }
  if (key === "supplementaryBillAmountRevenue") {
    return formatSupplementaryBillField(rows, "billAmountRevenue");
  }
  if (key === "supplementaryBillSentForPaymentDate") {
    return formatSupplementaryBillField(rows, "billSentForPaymentDate", true);
  }
  if (key === "supplementaryBillReturnCycles") return formatSupplementaryBillReturnCycles(rows);
  if (key === "supplementaryBillPaymentDate") {
    return formatSupplementaryBillField(rows, "paymentDate", true);
  }
  if (key === "supplementaryBillPaymentMode") {
    return formatSupplementaryBillField(rows, "paymentMode");
  }
  if (key === "supplementaryBillActualPaymentCapital") {
    return formatSupplementaryBillField(rows, "actualPaymentCapital");
  }
  if (key === "supplementaryBillActualPaymentRevenue") {
    return formatSupplementaryBillField(rows, "actualPaymentRevenue");
  }
  if (key === "supplementaryBillRemarks") return formatSupplementaryBillField(rows, "remarks");
  return undefined;
}

function normalizeSupplementaryBillsForTable(bills: SupplementaryBillDetail[] | undefined) {
  return (bills ?? []).filter((bill) =>
    [
      bill.billNo,
      bill.billAmountCapital,
      bill.billAmountRevenue,
      bill.billSentForPaymentDate,
      bill.paymentDate,
      bill.paymentMode,
      bill.actualPaymentCapital,
      bill.actualPaymentRevenue,
      bill.remarks,
      formatBillReturnCycles(bill.billReturnCycles),
    ].some((value) => String(value ?? "").trim()),
  );
}

function formatSupplementaryBillField(
  bills: SupplementaryBillDetail[],
  key: keyof SupplementaryBillDetail,
  isDate = false,
) {
  return bills
    .map((bill, index, rows) => {
      const rawValue = String(bill[key] ?? "").trim();
      if (!rawValue) return "";
      const value = isDate ? formatIsoDateForDisplay(rawValue) : rawValue;
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function formatSupplementaryBillReturnCycles(bills: SupplementaryBillDetail[]) {
  return bills
    .map((bill, index, rows) => {
      const value = formatBillReturnCycles(bill.billReturnCycles);
      if (!value) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function formatSupplementaryBills(bills: SupplementaryBillDetail[]) {
  return bills
    .map((bill, index, rows) => {
      const parts = [
        bill.billNo ? `Bill No.: ${bill.billNo}` : "",
        bill.billAmountCapital ? `Amount capital: ${bill.billAmountCapital}` : "",
        bill.billAmountRevenue ? `Amount revenue: ${bill.billAmountRevenue}` : "",
        bill.billSentForPaymentDate
          ? `Submitted: ${formatIsoDateForDisplay(bill.billSentForPaymentDate)}`
          : "",
        formatBillReturnCycles(bill.billReturnCycles),
        bill.paymentDate ? `Paid: ${formatIsoDateForDisplay(bill.paymentDate)}` : "",
        bill.paymentMode ? `Mode: ${bill.paymentMode}` : "",
        bill.actualPaymentCapital ? `Actual capital: ${bill.actualPaymentCapital}` : "",
        bill.actualPaymentRevenue ? `Actual revenue: ${bill.actualPaymentRevenue}` : "",
        bill.remarks ? `Remarks: ${bill.remarks}` : "",
      ].filter(Boolean);
      if (!parts.length) return "";
      return rows.length > 1 ? `${index + 1}. ${parts.join("; ")}` : parts.join("; ");
    })
    .filter(Boolean)
    .join("; ");
}

function toIsoDateForSort(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;
  const displayMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`;
  return "";
}

function isAdvancePaymentDetailField(key: SupplyOrderKey) {
  return (
    key === "advanceStageAmountCapital" ||
    key === "advanceStageAmountRevenue" ||
    key === "advancePaymentDate" ||
    key === "advanceActualPaymentCapital" ||
    key === "advanceActualPaymentRevenue"
  );
}

function getAdvancePaymentDetailValue(order: SupplyOrderDetail, key: SupplyOrderKey) {
  const detail =
    order.stageDeliveryLabel === "Advance Payment" ? order : order.advancePaymentDetail;
  if (!detail) return undefined;
  if (key === "advanceStageAmountCapital") return String(detail.stageAmountCapital ?? "");
  if (key === "advanceStageAmountRevenue") return String(detail.stageAmountRevenue ?? "");
  if (key === "advancePaymentDate") return String(detail.paymentDate ?? "");
  if (key === "advanceActualPaymentCapital") return String(detail.actualPaymentCapital ?? "");
  if (key === "advanceActualPaymentRevenue") return String(detail.actualPaymentRevenue ?? "");
  return undefined;
}

function hasAny(file: FileRecord, keys: FileKey[]) {
  return keys.some((key) =>
    isSupplyOrderKey(key)
      ? fileSupplyOrders(file).some((order) => Boolean(order[key]))
      : Boolean(file[key]),
  );
}

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
    applies: (file) => isYes(file.highValue),
  },
  {
    key: "tcec",
    previous: "scrutinyCompletionDate",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "ad",
    previous: "preTcecMinutesDate",
    current: "adVettingDate",
    applies: (file) => isYes(file.ad),
  },
  {
    key: "rqa",
    previous: "adVettingDate",
    current: "rqaApprovalDate",
    applies: (file) => isYes(file.rqa),
  },
  { key: "control", previous: "rqaApprovalDate", current: "immsDate" },
  {
    key: "ifa",
    previous: "immsDate",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file) => isYes(file.ifa),
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
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "refloatBidding",
    previous: "postTcecMinutesDate",
    current: "biddingStageOver",
    applies: (file) => isYes(file.refloat),
  },
  {
    key: "refloatPostTcec",
    previous: "biddingStageOver",
    reviewed: "refloatPostTcecDate",
    current: "refloatPostTcecMinutesDate",
    applies: (file) => isYes(file.refloat) && isYes(file.tcec) && isYes(file.biddingStageOver),
  },
  {
    key: "cnc",
    previous: "postTcecMinutesDate",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file) => isYes(file.tcec),
  },
  { key: "supplyOrder", previous: "postTcecMinutesDate", current: "soDate" },
  { key: "psb", previous: "soDate", current: "psbBgReceivedDate" },
  {
    key: "pwb",
    previous: "soDate",
    current: "pwbBgReceivedDate",
    applies: (file) => isYes(file.bg),
  },
  {
    key: "psbPwb",
    previous: "soDate",
    current: "combinedBgReceivedDate",
    applies: (file) => isYes(file.bg),
  },
  { key: "payment", previous: "combinedBgReceivedDate", current: "paymentDate" },
] satisfies Array<{
  key: string;
  previous: FileKey | SupplyOrderKey;
  reviewed?: FileKey | SupplyOrderKey;
  current: FileKey | SupplyOrderKey;
  applies?: (file: FileRecord) => boolean;
}>;

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultMilestones;
  return appendFileClosedMilestone(insertBillSentMilestone(insertRefloatMilestones(configured)));
}

function getConfiguredFirmTypes(firmTypes: string[] | undefined) {
  const seen = new Set<string>();
  const values = (firmTypes?.length ? firmTypes : defaultFirmTypes)
    .map((firmType) => firmType.trim())
    .filter((firmType) => {
      if (!firmType) return false;
      const key = firmType.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? values : defaultFirmTypes;
}

function getEffectiveFirmType(order: SupplyOrderDetail) {
  const firmType = order.firmType?.trim() || "";
  const firmTypeOther = order.firmTypeOther?.trim() || "";
  if (firmType.toUpperCase() === "OTHER") return firmTypeOther || firmType;
  return firmType || firmTypeOther;
}

function getConfiguredFileTypeOptions(
  fileTypes: string[] | undefined,
  selectedFileTypes: string[],
) {
  const seen = new Set<string>();
  const values = [...(fileTypes?.length ? fileTypes : defaultFileTypeOptions), ...selectedFileTypes]
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      if (!fileType || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? values : defaultFileTypeOptions;
}

function getConfiguredModes(modes: string[] | undefined, selectedModes: string[]) {
  const seen = new Set<string>();
  const values = [...(modes?.length ? modes : defaultModeOptions), ...selectedModes]
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode) => {
      if (!mode) return false;
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    });
  return values.length ? values : defaultModeOptions;
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
  const hasBillReturned = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "billreturnedforcorrection",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (paymentIndex === -1) return milestones;
  let next = milestones;
  if (!hasBillSent) {
    next = [...next.slice(0, paymentIndex), "Bill sent for payment", ...next.slice(paymentIndex)];
  }
  if (hasBillReturned) return next;
  const nextPaymentIndex = next.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  return [
    ...next.slice(0, nextPaymentIndex),
    "Bill returned for correction",
    ...next.slice(nextPaymentIndex),
  ];
}

function insertRefloatMilestones(milestones: string[]) {
  const hasRefloatBidding = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "refloatbidding",
  );
  const hasRefloatPostTcec = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "refloatposttcec",
  );
  if (hasRefloatBidding && hasRefloatPostTcec) return milestones;
  const postTcecIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "posttcec",
  );
  const cncIndex = milestones.findIndex((milestone) => normalizeMilestoneName(milestone) === "cnc");
  let insertIndex = postTcecIndex === -1 ? cncIndex : postTcecIndex + 1;
  if (insertIndex < 0) insertIndex = milestones.length;
  const additions = [
    hasRefloatBidding ? undefined : "Refloat bidding",
    hasRefloatPostTcec ? undefined : "Refloat Post-TCEC",
  ].filter((item): item is string => Boolean(item));
  return [...milestones.slice(0, insertIndex), ...additions, ...milestones.slice(insertIndex)];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function isPendingMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
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
  if (isBgMilestoneKey(milestone.key)) {
    return expectedSupplyOrders(file).some((order) =>
      isBgCategoryApplicable(file, order, milestone.key),
    );
  }

  const targetIndex = milestoneDefinitions.findIndex((item) => item.key === milestone.key);
  if (targetIndex <= 0) return hasMilestoneDate(file, "receivedDate");
  if (isFlexiblePreControlMilestone(milestone)) {
    const scrutiny = milestoneDefinitions.find((item) => item.key === "scrutiny");
    return scrutiny ? isMilestoneComplete(file, scrutiny) : hasMilestoneDate(file, "receivedDate");
  }
  const controlIndex = milestoneDefinitions.findIndex((item) => item.key === "control");
  if (controlIndex >= 0 && targetIndex >= controlIndex) {
    return milestoneDefinitions.slice(0, targetIndex).every((item) => {
      if (!isMilestoneApplicable(file, item)) return true;
      return isMilestoneComplete(file, item);
    });
  }
  return milestoneDefinitions.slice(0, targetIndex).every((item) => {
    if (item.key !== "scrutiny") return true;
    return !isMilestoneApplicable(file, item) || isMilestoneComplete(file, item);
  });
}

function isFlexiblePreControlMilestone(
  milestone: Pick<(typeof milestoneDefinitions)[number], "key">,
) {
  return ["highValue", "tcec", "ad", "rqa"].includes(milestone.key);
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") {
    return isYes(file.biddingStageOver);
  }
  if (milestone.key === "refloatBidding") {
    return isYes(file.refloat) && isYes(file.biddingStageOver);
  }
  if (milestone.key === "financialSanction") {
    return matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction");
  }
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
    psb: "PSB",
    pwb: "PWB",
    psbPwb: "PSB+PWB",
    payment: "Payment",
  };
  return key === "control" ? [labels[key], "Controlled"] : [labels[key] ?? key];
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
    return fileSupplyOrders(file).some((order) => {
      const value = order[key as SupplyOrderKey];
      return typeof value === "string" && hasFilledString(value);
    });
  }
  const value = file[key as FileKey];
  return typeof value === "string" && hasFilledString(value);
}

const supplyOrderDateKeys = new Set<SupplyOrderKey>([
  "financialSanctionDate",
  "soDate",
  "deliveryPeriodStartDate",
  "dpDate",
  "revisedDp",
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
  "advancePaymentDate",
]);

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
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

function isPreBidMeetingStatus(
  file: FileRecord,
  refloat: boolean,
  state: "due" | "completed",
  monthKey = "",
) {
  if (!isBiddingApplicableForFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  if (monthKey && date.slice(0, 7) !== monthKey) return false;
  return state === "completed" ? isDateBeforeToday(date) : !isDateBeforeToday(date);
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgMilestoneKey(key: string) {
  const normalized = normalizeMilestoneName(key);
  return normalized === "psb" || normalized === "pwb" || normalized === "psbpwb";
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

function isBgToBeReceived(file: FileRecord, category = "psb") {
  return expectedSupplyOrders(file).some((order) => isBgPendingOrder(file, order, category));
}

function isPsbApplicableFile(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      isYes(order.psbApplicable) &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately"),
  );
}

function isBgPendingOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    !isBgReceivedOrder(order, category) &&
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? isFinancialSanctionCompletedOrder(order)
      : hasFilledString(order.materialReceiptDate))
  );
}

function isBgCurrentOrder(order: SupplyOrderDetail, category: string) {
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
  return normalizeMilestoneName(order.currentMilestone) === normalizeMilestoneName(category);
}

function isBgToBeReturned(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgReturnDueOrder(file, order, category));
}

function isBgExpired(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgExpiredOrder(file, order, category));
}

function isBgReturned(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgReturnedOrder(file, order, category));
}

function isBgReturnedOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  return (
    isBgCategoryApplicable(file, order, category) &&
    hasFilledString(getBgReturnDate(order, category))
  );
}

function isBgReturnDueOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  if (
    !isBgCategoryApplicable(file, order, category) ||
    !isBgReceivedOrder(order, category) ||
    hasFilledString(getBgReturnDate(order, category))
  )
    return false;
  if (isYes(order.soCancelled) || isYes(order.shortclosure)) return true;
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    !isSupplyOrderCancelled(file, order) &&
    (normalizedCategory === "psb"
      ? isPsbReturnPurposeComplete(file, order)
      : isWarrantyBgReturnPurposeComplete(file, order, normalizedCategory))
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

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const validityDate = getBgValidityDate(order, category);
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !isSupplyOrderCancelled(file, order) &&
    (normalizedCategory === "psb"
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
  if (isCancelledFile(file) || !isSupplyOrderPlaced(file)) return false;
  if (!shouldUseOrderMilestoneRows(file))
    return fileSupplyOrders(file).some((order) => isOverdueDeliveryOrder(file, order));
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      isOrderCurrentForMilestone(file, order, "delivery") &&
      isOverdueDeliveryOrder(file, order),
  );
}

function isDeliveryDueToday(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isDueTodayDeliveryOrder);
}

function isDeliveryUpcoming(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isUpcomingDeliveryOrder);
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
  if (!isSupplyOrderPlaced(file)) return false;
  if (!shouldUseOrderMilestoneRows(file))
    return fileSupplyOrders(file).some((order) => isPendingDeliveryOrder(file, order));
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      isOrderCurrentForMilestone(file, order, "delivery") &&
      isPendingDeliveryOrder(file, order),
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

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function isCompletedDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    hasFilledString(order.materialReceiptDate)
  );
}

function isDeliveryFructified(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (isDeliveryInspectionApplicable(file) && hasFilledString(order.materialReceiptDate)) ||
    (!isDeliveryInspectionApplicable(file) && isJobCompletionDone(order)) ||
    (order.completedMilestones ?? []).some(
      (milestone) => normalizeMilestoneName(milestone) === "delivery",
    )
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

function getDeliveryCompletionMonthDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return isJobCompletionDone(order) ? getDeliveryPeriodDate(order) : undefined;
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
  return isDueDeliveryOrder(file, order) && isCurrentDeliveryPeriodOrder(order);
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

function isBankGuaranteeEligible(file: FileRecord) {
  return (
    isYes(file.bg) &&
    expectedSupplyOrders(file).some((order) => !isSupplyOrderCancelled(file, order))
  );
}

function isBgReceived(file: FileRecord, category = "psb") {
  return expectedSupplyOrders(file).some(
    (order) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgReceivedOrder(order, category) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return hasFilledString(order.financialSanctionDate);
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
  if (isYes(order.shortclosure)) return order.jobCompletionDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function isPaymentPriorityDelayForContract(
  file: FileRecord,
  order: SupplyOrderDetail,
  thresholdDays: number,
) {
  if (!isContractFileType(file) || hasDate(order.paymentDate)) return false;
  if (isContractBillPreparationStarted(order)) return false;
  const daysInPaymentStage = getDaysSinceDate(getPaymentWorkflowStartDate(file, order));
  return daysInPaymentStage !== undefined && daysInPaymentStage > thresholdDays;
}

function isContractBillPreparationStarted(order: SupplyOrderDetail) {
  return (
    isJobCompletionDone(order) ||
    hasDate(order.billPreparationDate) ||
    hasDate(order.billSentForPaymentDate)
  );
}

function isPaymentDue(file: FileRecord) {
  return isPaymentPending(file);
}

function isPaymentPending(file: FileRecord) {
  return getFinancePaymentLiabilityEntries(file).some((entry) => entry.pending);
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
  return getFinancePaymentLiabilityEntries(file).some((entry) => {
    const orderYear = getFinancialYearForDate(entry.sourceDate);
    if (!orderYear) return false;
    const paymentDate = entry.paymentDate;
    const paidInSelectedYear = isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd =
      !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
    if (mode === "futureClearedCarryForward") {
      return (
        orderYear === selectedYear &&
        hasFilledString(paymentDate) &&
        isDateAfter(paymentDate, range.end) &&
        getFinancialYearForDate(paymentDate) === sourceYear
      );
    }
    if (orderYear !== sourceYear) return false;
    if (mode === "carryForward") return orderYear === selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "clearedCarryForward") return orderYear < selectedYear && paidInSelectedYear;
    if (mode === "previousCarryForward") return orderYear < selectedYear && unpaidAtSelectedYearEnd;
    return false;
  });
}

function getFinancePaymentLiabilityEntries(file: FileRecord) {
  if (isYes(file.demandCancelled)) return [];
  return rawSupplyOrders(file).flatMap((baseOrder) => {
    if (isSupplyOrderCancelled(file, baseOrder)) return [];
    const mainEntries = finalPaymentOrders({ ...file, supplyOrders: [baseOrder] })
      .filter((order) => isPaymentOrderActive(file, order))
      .map((order) => ({
        kind: "main" as const,
        sourceDate: order.soDate || baseOrder.soDate,
        paymentDate: order.paymentDate,
        pending: hasPaymentWorkflowStarted(file, order) && !hasFilledString(order.paymentDate),
      }));
    const supplementaryEntries = getSupplementaryBills(baseOrder)
      .filter(isSupplementaryPaymentRelevant)
      .map((bill) => ({
        kind: "supplementary" as const,
        bill,
        sourceDate: baseOrder.soDate,
        paymentDate: bill.paymentDate,
        pending: isSupplementaryPaymentPending(bill),
      }));
    return [...mainEntries, ...supplementaryEntries];
  });
}

function isSupplementaryPaymentRelevant(bill: SupplementaryBillDetail) {
  return (
    hasFilledString(bill.billSentForPaymentDate) ||
    hasFilledString(bill.paymentDate) ||
    hasSupplementaryBillReturnHistory(bill)
  );
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

function hasSupplementaryBillPending(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillSubmitted);
  });
}

function hasSupplementaryBillPaid(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillPaid);
  });
}

function hasReturnedSupplementaryBillPaid(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isReturnedSupplementaryBillPaid);
  });
}

function hasSupplementaryBillReturnHistoryFile(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(hasSupplementaryBillReturnHistory);
  });
}

function hasSupplementaryBillReturned(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillReturned);
  });
}

function hasSupplementaryBillResubmitted(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillResubmitted);
  });
}

function getSupplementaryBills(order: SupplyOrderDetail) {
  return Array.isArray(order.supplementaryBills)
    ? order.supplementaryBills.filter(
        (bill): bill is NonNullable<SupplyOrderDetail["supplementaryBills"]>[number] =>
          Boolean(bill) && typeof bill === "object" && !Array.isArray(bill),
      )
    : [];
}

function hasSupplementaryBillData(bill: SupplementaryBillDetail) {
  return (
    [
      bill.billNo,
      bill.billAmountCapital,
      bill.billAmountRevenue,
      bill.billSentForPaymentDate,
      bill.paymentDate,
      bill.paymentMode,
      bill.actualPaymentCapital,
      bill.actualPaymentRevenue,
      bill.remarks,
    ].some(hasFilledString) || Boolean(bill.billReturnCycles?.some(hasBillReturnCycleData))
  );
}

function hasBillReturnCycleData(cycle: BillReturnCycle) {
  return [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(
    hasFilledString,
  );
}

function hasSupplementaryBillReturnHistory(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(hasBillReturnCycleData);
}

function isSupplementaryBillSubmitted(bill: SupplementaryBillDetail) {
  return (
    hasFilledString(bill.billSentForPaymentDate) &&
    !hasOpenSupplementaryBillReturn(bill) &&
    !hasCompletedSupplementaryBillReturn(bill) &&
    !hasFilledString(bill.paymentDate)
  );
}

function isSupplementaryBillReturned(bill: SupplementaryBillDetail) {
  return !hasFilledString(bill.paymentDate) && hasOpenSupplementaryBillReturn(bill);
}

function isSupplementaryBillResubmitted(bill: SupplementaryBillDetail) {
  return (
    !hasFilledString(bill.paymentDate) &&
    !hasOpenSupplementaryBillReturn(bill) &&
    hasCompletedSupplementaryBillReturn(bill)
  );
}

function isSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return hasSupplementaryBillData(bill) && hasFilledString(bill.paymentDate);
}

function isReturnedSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && hasCompletedSupplementaryBillReturn(bill);
}

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

function hasCompletedSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(
    (cycle) => hasFilledString(cycle.returnedDate) && hasFilledString(cycle.resubmittedDate),
  );
}

function getSupplementaryReturnedBillCashOutgoEventDate(
  bill: SupplementaryBillDetail,
  mode: string,
) {
  const cycles = bill.billReturnCycles ?? [];
  const returnedDates = cycles
    .filter((cycle) => hasFilledString(cycle.returnedDate))
    .map((cycle) => cycle.returnedDate);
  const openReturnedDates = cycles
    .filter(
      (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
    )
    .map((cycle) => cycle.returnedDate);
  const resubmittedDates = cycles
    .filter(
      (cycle) => hasFilledString(cycle.returnedDate) && hasFilledString(cycle.resubmittedDate),
    )
    .map((cycle) => cycle.resubmittedDate);

  if (mode === "supplementaryReturnedBills") return earliestDate(returnedDates);
  if (mode === "supplementaryPendingReturnedBills") {
    if (hasFilledString(bill.paymentDate)) return undefined;
    return earliestDate(openReturnedDates);
  }
  if (mode === "supplementaryReturnedBillsResubmitted") {
    if (hasFilledString(bill.paymentDate) || openReturnedDates.length || !resubmittedDates.length) {
      return undefined;
    }
    return earliestDate(resubmittedDates);
  }
  if (mode === "supplementaryReturnedBillsPaid") {
    return returnedDates.length && hasFilledString(bill.paymentDate) ? bill.paymentDate : undefined;
  }
  return undefined;
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

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime > todayTime;
}

function isDateToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

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
    biddingMatch ||
    mainMatch ||
    isOrderDelayStatusMatch(file, thresholdDays, selectedMilestoneKey) ||
    isSupplementaryBillReturnedDelayMatch(file, thresholdDays, selectedMilestoneKey)
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
        const paymentPriorityDelay = isPaymentPriorityDelayForContract(file, order, thresholdDays);
        if (isSupplyOrderCancelled(file, order)) return false;
        if ("applies" in milestone && milestone.applies && !milestone.applies(file)) return false;
        if (milestone.key === "jobCompletion" && paymentPriorityDelay) {
          return false;
        }
        if (
          !(milestone.key === "payment" && paymentPriorityDelay) &&
          getOrderDelayCurrentMilestone(file, order, milestone.current) !== milestone.current
        )
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
      key: "billReturnedForCorrection",
      current: "billreturnedforcorrection",
      start: (_file: FileRecord, order: SupplyOrderDetail) => getEarliestOpenBillReturnDate(order),
      complete: (order: SupplyOrderDetail) => (hasOpenBillReturn(order) ? undefined : "9999-12-31"),
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

function isSupplementaryBillReturnedDelayMatch(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  if (
    selectedMilestoneKey !== "all" &&
    selectedMilestoneKey !== supplementaryBillReturnedDelayMilestoneKey
  ) {
    return false;
  }
  if (isYes(file.demandCancelled)) return false;
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some((bill) => {
      if (!isSupplementaryBillReturned(bill)) return false;
      const daysInStage = getDaysSinceDate(getEarliestOpenSupplementaryBillReturnDate(bill));
      return daysInStage !== undefined && daysInStage > thresholdDays;
    });
  });
}

function getEarliestOpenBillReturnDate(order: SupplyOrderDetail) {
  return normalizeOpenReturnDates(order.billReturnCycles)[0];
}

function getEarliestOpenSupplementaryBillReturnDate(bill: SupplementaryBillDetail) {
  return normalizeOpenReturnDates(bill.billReturnCycles)[0];
}

function normalizeOpenReturnDates(cycles: SupplyOrderDetail["billReturnCycles"]) {
  return (cycles ?? [])
    .filter(
      (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
    )
    .map((cycle) => cycle.returnedDate)
    .filter((date): date is string => hasFilledString(date))
    .sort();
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
  const targetIndex = milestoneDefinitions.findIndex((item) => item.key === milestone.key);
  if (targetIndex <= 0) return undefined;
  if (isFlexiblePreControlMilestone(milestone)) {
    return milestoneDefinitions.find((item) => item.key === "scrutiny");
  }
  const controlIndex = milestoneDefinitions.findIndex((item) => item.key === "control");
  const previous = milestoneDefinitions.slice(0, targetIndex).filter((item) => {
    if (!isMilestoneApplicable(file, item)) return false;
    if (controlIndex >= 0 && targetIndex >= controlIndex) return true;
    return item.key === "scrutiny";
  });
  return previous[previous.length - 1];
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

function getMonthEndDateFromMonthKey(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number.parseInt(yearText ?? "", 10);
  const month = Number.parseInt(monthText ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return `${monthKey}-31`;
  }
  return formatLocalDate(new Date(year, month, 0));
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
    "expectedReceiptPendingBillThrough",
    "billPreparation",
    "billPreparationThrough",
    "billSent",
    "billSentThrough",
    "actual",
    "actualThrough",
    "expectedDpThrough",
    "supplementaryBillSent",
    "supplementaryActual",
    "returnedBills",
    "pendingReturnedBills",
    "returnedBillsResubmitted",
    "returnedBillsPaid",
    "supplementaryReturnedBills",
    "supplementaryPendingReturnedBills",
    "supplementaryReturnedBillsResubmitted",
    "supplementaryReturnedBillsPaid",
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

function earliestDate(dates: Array<string | undefined>) {
  return dates.filter(hasFilledString).sort()[0];
}

function getActiveSupplementaryBillSubmissionDate(bill: SupplementaryBillDetail) {
  const resubmittedDates = (bill.billReturnCycles ?? [])
    .map((cycle) => cycle.resubmittedDate)
    .filter(hasFilledString)
    .sort();
  return resubmittedDates[resubmittedDates.length - 1] ?? bill.billSentForPaymentDate;
}

function isCashOutgoFilterMatch(file: FileRecord, filter: string) {
  const parsed = readCashOutgoFilter(filter);
  if (!parsed || isCancelledFile(file)) return false;
  const orders =
    parsed.mode === "billPreparation" ||
    parsed.mode === "billPreparationThrough" ||
    parsed.mode === "billSent" ||
    parsed.mode === "billSentThrough" ||
    parsed.mode === "actual" ||
    parsed.mode === "actualThrough" ||
    parsed.mode === "supplementaryBillSent" ||
    parsed.mode === "supplementaryActual" ||
    parsed.mode === "returnedBills" ||
    parsed.mode === "pendingReturnedBills" ||
    parsed.mode === "returnedBillsResubmitted" ||
    parsed.mode === "returnedBillsPaid" ||
    parsed.mode === "supplementaryReturnedBills" ||
    parsed.mode === "supplementaryPendingReturnedBills" ||
    parsed.mode === "supplementaryReturnedBillsResubmitted" ||
    parsed.mode === "supplementaryReturnedBillsPaid"
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
        monthMatches(cashOutgoDate, parsed.monthKey) &&
        dateInRange(reportDate, parsed.fromDate, parsed.toDate)
      );
    }
    if (parsed.mode === "billPreparation" || parsed.mode === "billPreparationThrough") {
      if (isSupplyOrderCancelled(file, order)) return false;
      const throughDate =
        parsed.mode === "billPreparationThrough"
          ? (parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey))
          : undefined;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      const orderMatches =
        (isAdvancePayment || hasFilledString(reportDate)) &&
        hasFilledString(order.billPreparationDate) &&
        (isAdvancePayment || isOnOrBefore(reportDate, throughDate ?? toDate)) &&
        isOnOrBefore(order.billPreparationDate, throughDate ?? toDate) &&
        ((throughDate ?? toDate)
          ? isMissingOrAfter(order.billSentForPaymentDate, throughDate ?? toDate) ||
            hasOpenBillReturn(order)
          : !hasFilledString(order.billSentForPaymentDate)) &&
        ((throughDate ?? toDate)
          ? isMissingOrAfter(order.paymentDate, throughDate ?? toDate)
          : !hasFilledString(order.paymentDate)) &&
        (throughDate
          ? isOnOrBefore(order.billPreparationDate, throughDate) &&
            dateInRange(order.billPreparationDate, parsed.fromDate, throughDate)
          : rangeMatches(order.billPreparationDate));
      const supplementaryMatches = getSupplementaryBills(order).some((bill) => {
        if (hasFilledString(bill.paymentDate)) return false;
        const returnedDate = getSupplementaryReturnedBillCashOutgoEventDate(
          bill,
          "supplementaryPendingReturnedBills",
        );
        if (!returnedDate) return false;
        if (throughDate) {
          return (
            isOnOrBefore(returnedDate, throughDate) &&
            dateInRange(returnedDate, parsed.fromDate, throughDate)
          );
        }
        return rangeMatches(returnedDate);
      });
      return orderMatches || supplementaryMatches;
    }
    if (parsed.mode === "billSent" || parsed.mode === "billSentThrough") {
      if (isSupplyOrderCancelled(file, order)) return false;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      const throughDate =
        parsed.mode === "billSentThrough"
          ? (parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey))
          : undefined;
      const orderMatches =
        (isAdvancePayment || hasFilledString(reportDate)) &&
        hasFilledString(order.billPreparationDate) &&
        hasFilledString(order.billSentForPaymentDate) &&
        (isAdvancePayment || isOnOrBefore(reportDate, throughDate ?? toDate)) &&
        isOnOrBefore(order.billPreparationDate, throughDate ?? toDate) &&
        isOnOrBefore(order.billSentForPaymentDate, throughDate ?? toDate) &&
        ((throughDate ?? toDate)
          ? isMissingOrAfter(order.paymentDate, throughDate ?? toDate)
          : !hasFilledString(order.paymentDate)) &&
        (throughDate
          ? isOnOrBefore(order.billSentForPaymentDate, throughDate) &&
            dateInRange(order.billSentForPaymentDate, parsed.fromDate, throughDate)
          : rangeMatches(order.billSentForPaymentDate));
      const supplementaryMatches = getSupplementaryBills(order).some((bill) => {
        if (hasFilledString(bill.paymentDate) || hasOpenSupplementaryBillReturn(bill)) return false;
        const submissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!hasFilledString(submissionDate)) return false;
        if (throughDate) {
          return (
            isOnOrBefore(submissionDate, throughDate) &&
            isMissingOrAfter(bill.paymentDate, throughDate) &&
            dateInRange(submissionDate, parsed.fromDate, throughDate)
          );
        }
        return (
          isOnOrBefore(submissionDate, toDate) &&
          (toDate ? isMissingOrAfter(bill.paymentDate, toDate) : true) &&
          rangeMatches(submissionDate)
        );
      });
      return orderMatches || supplementaryMatches;
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
    if (
      parsed.mode === "supplementaryReturnedBills" ||
      parsed.mode === "supplementaryPendingReturnedBills" ||
      parsed.mode === "supplementaryReturnedBillsResubmitted" ||
      parsed.mode === "supplementaryReturnedBillsPaid"
    ) {
      if (isSupplyOrderCancelled(file, order)) return false;
      return getSupplementaryBills(order).some((bill) =>
        rangeMatches(getSupplementaryReturnedBillCashOutgoEventDate(bill, parsed.mode)),
      );
    }
    if (parsed.mode === "actual" || parsed.mode === "actualThrough") {
      const throughDate =
        parsed.mode === "actualThrough"
          ? (parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey))
          : undefined;
      const orderMatches =
        hasFilledString(order.paymentDate) &&
        !(isYes(order.soCancelled) && hasFilledString(order.soCancelledDate)) &&
        (throughDate
          ? isOnOrBefore(order.paymentDate, throughDate) &&
            dateInRange(order.paymentDate, parsed.fromDate, throughDate)
          : rangeMatches(order.paymentDate));
      const supplementaryMatches = getSupplementaryBills(order).some(
        (bill) =>
          hasFilledString(bill.paymentDate) &&
          (throughDate
            ? isOnOrBefore(bill.paymentDate, throughDate) &&
              dateInRange(bill.paymentDate, parsed.fromDate, throughDate)
            : rangeMatches(bill.paymentDate)),
      );
      return orderMatches || supplementaryMatches;
    }
    if (parsed.mode === "supplementaryBillSent") {
      if (isSupplyOrderCancelled(file, order)) return false;
      return getSupplementaryBills(order).some((bill) => {
        if (hasFilledString(bill.paymentDate) || hasOpenSupplementaryBillReturn(bill)) return false;
        const submissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        return (
          hasFilledString(submissionDate) &&
          isOnOrBefore(submissionDate, toDate) &&
          (toDate ? isMissingOrAfter(bill.paymentDate, toDate) : true) &&
          rangeMatches(submissionDate)
        );
      });
    }
    if (parsed.mode === "supplementaryActual") {
      if (isSupplyOrderCancelled(file, order)) return false;
      return getSupplementaryBills(order).some(
        (bill) => hasFilledString(bill.paymentDate) && rangeMatches(bill.paymentDate),
      );
    }
    return false;
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

function getReceiptPendingBillReportDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (!isContractFileType(file) && isNo(file.ir)) return order.jobCompletionDate;
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

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (!shouldAllowDemandCancelledDashboardFilter(filter) && isYes(file.demandCancelled)) {
    return false;
  }
  if (!shouldAllowInactiveDashboardFilter(filter) && isCancelledFile(file)) return false;
  if (filter.startsWith("delayFile:")) {
    return file.id === filter.slice("delayFile:".length);
  }
  if (filter.startsWith("financeCarryForward:")) {
    return matchesFinanceCarryForwardFilter(file, filter);
  }
  if (filter.startsWith("anomalyFile:")) {
    return file.id === decodeStatusFilterPart(filter.slice("anomalyFile:".length));
  }
  if (filter.startsWith("fileIds:")) {
    const ids = filter
      .slice("fileIds:".length)
      .split(",")
      .map((id) => decodeStatusFilterPart(id).trim())
      .filter(Boolean);
    return ids.includes(file.id);
  }
  if (filter.startsWith("cashOutgoAny:")) return isCashOutgoAnyFilterMatch(file, filter);
  if (filter.startsWith("cashOutgo:")) return isCashOutgoFilterMatch(file, filter);
  if (filter.startsWith("status4:")) return matchesStatus4DashboardFilter(file, filter);
  if (filter.startsWith("delayStatus:")) {
    const [, daysValue = "0", milestoneKey = "all"] = filter.split(":");
    return isDelayStatusMatch(file, getDelayThresholdDays(daysValue), milestoneKey);
  }
  if (filter.startsWith("biddingDelay:")) {
    const [, daysValue = "0", breakupKey = ""] = filter.split(":");
    return isBiddingDelayMatch(file, getDelayThresholdDays(daysValue), breakupKey);
  }
  if (filter.startsWith("demandProcessing:")) {
    const [, rawFrom = "", rawTo = "", mode = "used"] = filter.split(":");
    const rows = buildDemandProcessingRows(
      [file],
      decodeStatusFilterPart(rawFrom),
      decodeStatusFilterPart(rawTo),
    );
    if (mode === "reverse") return rows.some((row) => row.gapDays < 0);
    return rows.length > 0;
  }
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    if (key === "psb") {
      if (value === "yes") return isPsbApplicableFile(file);
      if (value === "no") return !isPsbApplicableFile(file);
    }
    const fieldValue = String(file[key as keyof FileRecord] ?? "");
    if (value === "yes") return isYes(fieldValue);
    if (value === "no") return !isYes(fieldValue);
  }
  if (filter.startsWith("firmType:")) {
    const firmType = decodeURIComponent(filter.slice("firmType:".length)).trim().toUpperCase();
    if (!firmType) return true;
    return fileSupplyOrders(file).some(
      (order) => getEffectiveFirmType(order).toUpperCase() === firmType,
    );
  }
  if (filter.startsWith("gemBiddingMode:")) {
    const mode = decodeURIComponent(filter.slice("gemBiddingMode:".length)).trim().toLowerCase();
    return isYes(file.gem) && (file.gemBiddingMode ?? "").trim().toLowerCase() === mode;
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    const monthKey = filter.slice("supplyOrderMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return rawSupplyOrders(file).some((order) => order.soDate?.slice(0, 7) === monthKey);
  }
  if (filter.startsWith("supplyOrderYear:")) {
    const yearKey = filter.slice("supplyOrderYear:".length);
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return true;
    return rawSupplyOrders(file).some(
      (order) =>
        hasFilledString(order.soDate) &&
        (yearKey === "all" || order.soDate!.slice(0, 4) === yearKey),
    );
  }
  if (filter.startsWith("fileInflowYear:")) {
    const yearKey = filter.slice("fileInflowYear:".length);
    if (yearKey === "all") return hasFilledString(file.receivedDate);
    if (!/^\d{4}$/.test(yearKey)) return true;
    return file.receivedDate?.slice(0, 4) === yearKey;
  }
  if (filter.startsWith("completedDeliveryMonth:")) {
    const monthKey = filter.slice("completedDeliveryMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return fileSupplyOrders(file).some(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        getDeliveryCompletionMonthDate(file, order)?.slice(0, 7) === monthKey,
    );
  }
  if (filter.startsWith("completedDeliveryYear:")) {
    const yearKey = filter.slice("completedDeliveryYear:".length);
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return true;
    return fileSupplyOrders(file).some((order) => {
      const completionDate = getDeliveryCompletionMonthDate(file, order);
      return (
        !isSupplyOrderCancelled(file, order) &&
        hasFilledString(completionDate) &&
        (yearKey === "all" || completionDate!.slice(0, 4) === yearKey)
      );
    });
  }
  if (filter.startsWith("fileCategory:")) {
    const categories = normalizeFileCategories([filter.slice("fileCategory:".length)]);
    return fileMatchesCategory(file, categories);
  }
  if (filter.startsWith("fileType:")) {
    const fileType = decodeURIComponent(filter.slice("fileType:".length));
    return (file.fileType ?? "").trim().toLowerCase() === fileType.trim().toLowerCase();
  }
  if (filter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = filter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    return matchesStatusSummaryFilter(file, milestone, stage);
  }
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return isBgToBeReceived(file);
    if (normalized === "supplementarybillreturnedforcorrection") {
      return hasSupplementaryBillReturned(file);
    }
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
  if (filter.startsWith("preBidMeeting:") || filter.startsWith("refloatPreBidMeeting:")) {
    const [kind = "", state = "all", monthKey = ""] = filter.split(":");
    const refloat = kind === "refloatPreBidMeeting";
    if (state === "all") {
      return (
        isPreBidMeetingStatus(file, refloat, "due", monthKey) ||
        isPreBidMeetingStatus(file, refloat, "completed", monthKey)
      );
    }
    if (state === "due" || state === "completed") {
      return isPreBidMeetingStatus(file, refloat, state, monthKey);
    }
    return false;
  }
  if (filter === "supplyOrders") return hasAny(file, ["soDate"]);
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
  if (filter === "supplementaryBill:any") return hasSupplementaryBillReturnHistoryFile(file);
  if (filter === "supplementaryBill:submitted" || filter === "supplementaryBill:pending")
    return hasSupplementaryBillPending(file);
  if (filter === "supplementaryBill:returned") return hasSupplementaryBillReturned(file);
  if (filter === "supplementaryBill:resubmitted") return hasSupplementaryBillResubmitted(file);
  if (filter === "supplementaryBill:paid") return hasSupplementaryBillPaid(file);
  if (filter === "supplementaryBill:returnPaid") return hasReturnedSupplementaryBillPaid(file);
  if (filter === "miscLiveFiles") return !isFileClosed(file) && !isCancelledFile(file);
  if (filter === "miscFileClosed") return isFileClosed(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled") {
    return isYes(file.demandCancelled);
  }
  if (filter === "miscSoCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  }
  if (filter === "miscShortclosedSo") {
    return fileSupplyOrders(file).some((order) => isYes(order.shortclosure));
  }
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
      ? expectedSupplyOrders(file).some(
          (order) =>
            isBgCategoryApplicable(file, order, milestone.key) &&
            !isSupplyOrderCancelled(file, order),
        )
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    if (milestone?.key === "refloatPostTcec") {
      return isYes(file.refloat) && !isYes(file.biddingStageOver);
    }
    if (milestone?.key === "refloatBidding") return false;
    return milestone
      ? isMilestoneApplicable(file, milestone) && !isEligibleMilestone(file, milestone)
      : true;
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
    if (milestone.key === "bidding") {
      return (
        isManualActiveMilestone(file, milestone) && !isFileTenderLive(file) && !isBidOverdue(file)
      );
    }
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
    (item) => normalizeMilestoneName(item.label) === normalized,
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

function isCancellationDashboardFilter(filter: string) {
  return (
    filter === "miscDemandCancelled" ||
    filter === "miscSoCancelled" ||
    filter === "miscShortclosedSo" ||
    filter.startsWith("supplyOrderMonth:") ||
    filter.startsWith("supplyOrderYear:")
  );
}

function isInactiveHistoryDashboardFilter(filter: string) {
  return (
    filter === "divisionTurnaroundSample" ||
    filter.startsWith("mode:") ||
    filter.startsWith("gemBiddingMode:") ||
    filter.startsWith("preBidMeeting:") ||
    filter.startsWith("refloatPreBidMeeting:") ||
    filter.startsWith("preBidMeetingFy:") ||
    filter.startsWith("refloatPreBidMeetingFy:") ||
    filter.startsWith("tcecStatus:") ||
    filter.startsWith("tcecStatusFy:") ||
    filter.startsWith("cncSummary:") ||
    filter.startsWith("cncSummaryFy:")
  );
}

function shouldAllowInactiveDashboardFilter(filter: string) {
  return isCancellationDashboardFilter(filter) || isInactiveHistoryDashboardFilter(filter);
}

function shouldAllowDemandCancelledDashboardFilter(filter: string) {
  return (
    isCancellationDashboardFilter(filter) ||
    (isInactiveHistoryDashboardFilter(filter) &&
      filter !== "divisionTurnaroundSample" &&
      !filter.startsWith("mode:") &&
      !filter.startsWith("gemBiddingMode:"))
  );
}

function decodeStatusFilterPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getDestinationFocus(
  dashboardFilter: string | undefined,
  focusSection: string | undefined,
  focusMilestone: string | undefined,
  focusTarget: string | undefined,
) {
  if (focusSection || focusMilestone || focusTarget) {
    return {
      section: focusSection || (focusMilestone ? "Milestones" : "Timeline"),
      milestone: focusMilestone,
      focusTarget,
    };
  }
  if (!dashboardFilter)
    return { section: "Timeline", milestone: undefined, focusTarget: undefined };
  if (dashboardFilter.startsWith("delayFile:")) {
    return { section: "Timeline", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("anomalyFile:")) {
    return {
      section: "Timeline",
      milestone: undefined,
      focusTarget: undefined,
    };
  }
  if (dashboardFilter.startsWith("firmType:")) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "firmtype:any",
    };
  }
  if (dashboardFilter.startsWith("fileCategory:") || dashboardFilter.startsWith("fileType:")) {
    return { section: "File details", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("valueThreshold:")) {
    const { metric } = parseValueThresholdDashboardFilter(dashboardFilter, "valueThreshold:");
    return {
      section: "File details",
      milestone: undefined,
      focusTarget: metric === "revenue" ? "valueRevenue" : "valueCapital",
    };
  }
  if (dashboardFilter.startsWith("soValueThreshold:")) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "supplyorder:any",
    };
  }
  if (dashboardFilter.startsWith("mode:")) {
    return { section: "Bidding details", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("gemBiddingMode:")) {
    return { section: "Bidding details", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("attribute:")) {
    return getSnapshotAttributeDestinationFocus(dashboardFilter);
  }
  if (dashboardFilter.startsWith("fileIds:")) {
    return { section: "Timeline", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("demandProcessing:")) {
    const focus = getDemandProcessingDestinationFocus(dashboardFilter);
    if (focus) return focus;
  }
  if (
    dashboardFilter === "liveBids" ||
    dashboardFilter === "bidOverdue" ||
    dashboardFilter.startsWith("preBidMeeting:") ||
    dashboardFilter.startsWith("refloatPreBidMeeting:") ||
    dashboardFilter.startsWith("preBidMeetingFy:") ||
    dashboardFilter.startsWith("refloatPreBidMeetingFy:")
  ) {
    return { section: "Bidding details", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("tcecStatus:") || dashboardFilter.startsWith("tcecStatusFy:")) {
    const [, rawStage = "pre"] = dashboardFilter.split(":");
    const stage = decodeURIComponent(rawStage);
    return {
      section: stage === "post" ? "Post-TCEC" : "Pre-TCEC",
      milestone: undefined,
      focusTarget: undefined,
    };
  }
  if (dashboardFilter.startsWith("cncSummary:") || dashboardFilter.startsWith("cncSummaryFy:")) {
    return { section: "Approval block", milestone: undefined, focusTarget: undefined };
  }
  if (dashboardFilter === "miscFileClosed") {
    return { section: "Milestones", milestone: "File Closed", focusTarget: undefined };
  }
  if (dashboardFilter === "advancePaid" || dashboardFilter === "advancePending") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `advancepayment:${dashboardFilter === "advancePaid" ? "paid" : "pending"}`,
    };
  }
  if (dashboardFilter.startsWith("billReturn:")) {
    const [, rawState = "any"] = dashboardFilter.split(":");
    const state = decodeStatusFilterPart(rawState);
    const focusState =
      state === "pending"
        ? "pending"
        : state === "resubmitted"
          ? "resubmitted"
          : state === "paid"
            ? "paid"
            : "any";
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `billreturnedforcorrection:${focusState}`,
    };
  }
  if (dashboardFilter.startsWith("supplementaryBill:")) {
    const [, rawState = "submitted"] = dashboardFilter.split(":");
    const state = decodeStatusFilterPart(rawState);
    let focusState = "submitted";
    if (state === "any") focusState = "anyreturned";
    else if (state === "returned") focusState = "returned";
    else if (state === "resubmitted") focusState = "resubmitted";
    else if (state === "returnPaid") focusState = "returnpaid";
    else if (state === "paid") focusState = "paid";
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `supplementarybill:${focusState}`,
    };
  }
  if (dashboardFilter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = dashboardFilter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    if (normalizeMilestoneName(milestone) === "supplementarybills") {
      const state = normalizeStatusStage(stage);
      const focusState = ["returned", "resubmitted", "paid"].includes(state) ? state : "submitted";
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `supplementarybill:${focusState}`,
      };
    }
  }
  if (dashboardFilter.startsWith("status4:")) {
    const [, rawMilestone = "", rawMetric = ""] = dashboardFilter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      const completedFocusTarget = getStatus4CompletedSupplyOrderFocusTarget(milestone, rawMetric);
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: completedFocusTarget ?? `${normalizeMilestoneName(milestone)}:current`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Milestones", milestone, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("financeCarryForward:")) {
    const [, mode = ""] = dashboardFilter.split(":");
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget:
        mode === "clearedCarryForward" || mode === "futureClearedCarryForward"
          ? "payment:completed"
          : "payment:pending",
    };
  }
  const simpleFileDestination = getSimpleFileDestinationFocus(dashboardFilter);
  if (simpleFileDestination) return simpleFileDestination;
  if (dashboardFilter.startsWith("manualMilestoneCurrent:")) {
    const milestone = dashboardFilter.slice("manualMilestoneCurrent:".length);
    if (normalizeMilestoneName(milestone) === "supplementarybillreturnedforcorrection") {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: "supplementarybill:current",
      };
    }
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `${normalizeMilestoneName(milestone)}:current`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Milestones", milestone, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("manualMilestoneCompleted:")) {
    const milestone = dashboardFilter.slice("manualMilestoneCompleted:".length);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `${normalizeMilestoneName(milestone)}:completed`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Milestones", milestone, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = dashboardFilter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    if (
      isSupplyOrderDrivenMilestoneName(milestone) ||
      normalizeMilestoneName(milestone) === "deliveryperiod"
    ) {
      const focusState = getSupplyOrderFocusStateForStatusStage(stage);
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `${normalizeMilestoneName(milestone)}:${focusState}`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Milestones", milestone, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("milestone")) {
    const [filterKind = "", key = ""] = dashboardFilter.split(":");
    const milestone = milestoneDefinitions.find((item) => item.key === key)
      ? getMilestoneLabelAliases(key)[0]
      : undefined;
    if (milestone && isSupplyOrderDrivenMilestoneName(milestone)) {
      const targetState =
        filterKind === "milestoneTotal"
          ? "any"
          : filterKind === "milestoneCleared" || filterKind === "milestoneCompleted"
            ? "completed"
            : filterKind === "milestonePending"
              ? "pending"
              : "current";
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `${normalizeMilestoneName(milestone)}:${targetState}`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: milestone ? "Milestones" : "Timeline", milestone, focusTarget: undefined };
  }
  if (
    dashboardFilter.startsWith("cashOutgo") ||
    dashboardFilter.startsWith("cashOutgoAny") ||
    dashboardFilter === "paymentDue" ||
    dashboardFilter === "actualPaymentFilter" ||
    dashboardFilter === "advancePaymentFilter"
  ) {
    const focusTarget =
      getCashOutgoFocusTarget(dashboardFilter) ??
      (dashboardFilter === "actualPaymentFilter"
        ? "actualpayment:yes"
        : dashboardFilter === "advancePaymentFilter"
          ? "advancepayment:yes"
          : "payment:pending");
    return { section: "Supply order and payment", milestone: undefined, focusTarget };
  }
  if (dashboardFilter === "liveSupplyOrders") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "supplyorder:live",
    };
  }
  if (dashboardFilter === "supplyOrders") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "supplyorder:placed",
    };
  }
  if (dashboardFilter === "bgReceived") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "psb:received",
    };
  }
  if (dashboardFilter === "bgToBeReceived") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "psb:pending",
    };
  }
  if (dashboardFilter === "bgExpired") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "psb:expired",
    };
  }
  if (dashboardFilter === "bgToBeReturned") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "psb:tobereturned",
    };
  }
  if (dashboardFilter === "bgReturned") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "psb:returned",
    };
  }
  if (dashboardFilter.startsWith("bgExpired:")) {
    const category = dashboardFilter.slice("bgExpired:".length);
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${normalizeMilestoneName(category)}:expired`,
    };
  }
  if (dashboardFilter.startsWith("bgToBeReturned:")) {
    const category = dashboardFilter.slice("bgToBeReturned:".length);
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${normalizeMilestoneName(category)}:tobereturned`,
    };
  }
  if (dashboardFilter.startsWith("bgReturned:")) {
    const category = dashboardFilter.slice("bgReturned:".length);
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${normalizeMilestoneName(category)}:returned`,
    };
  }
  if (dashboardFilter.startsWith("bgExpiryMonth:") || dashboardFilter.startsWith("bgExpiryYear:")) {
    const [, category = "all"] = dashboardFilter.split(":");
    const focusKind = isBgMilestoneKey(category) ? normalizeMilestoneName(category) : "securitybg";
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${focusKind}:validity`,
    };
  }
  if (dashboardFilter.startsWith("bgReceiptDelay:")) {
    const [, category = "all"] = dashboardFilter.split(":");
    const focusKind = isBgMilestoneKey(category) ? normalizeMilestoneName(category) : "securitybg";
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${focusKind}:pending`,
    };
  }
  if (dashboardFilter.startsWith("warrantyBgMismatch:")) {
    const [, category = "all"] = dashboardFilter.split(":");
    const focusKind = isBgMilestoneKey(category) ? normalizeMilestoneName(category) : "securitybg";
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: `${focusKind}:validity`,
    };
  }
  if (dashboardFilter === "miscLd") {
    return { section: "Supply order and payment", milestone: undefined, focusTarget: "ld:yes" };
  }
  if (dashboardFilter === "dpExtension") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "dpextension:yes",
    };
  }
  if (dashboardFilter === "miscSoCancelled") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "socancelled:yes",
    };
  }
  if (dashboardFilter === "miscShortclosedSo") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "shortclosure:yes",
    };
  }
  if (dashboardFilter === "miscMultipleSupplyOrders") {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "supplyorder:any",
    };
  }
  if (
    dashboardFilter.startsWith("supplyOrderMonth:") ||
    dashboardFilter.startsWith("supplyOrderYear:")
  ) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "supplyorder:any",
    };
  }
  if (
    dashboardFilter.startsWith("fileInflowMonth:") ||
    dashboardFilter.startsWith("fileInflowYear:")
  ) {
    return { section: "File details", milestone: undefined, focusTarget: undefined };
  }
  if (
    dashboardFilter.startsWith("deliverySchedule:") ||
    dashboardFilter.startsWith("deliveryScheduleYear:")
  ) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "deliveryperiod:any",
    };
  }
  if (
    dashboardFilter.startsWith("completedDeliveryMonth:") ||
    dashboardFilter.startsWith("completedDeliveryYear:")
  ) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "delivery:done",
    };
  }
  if (dashboardFilter.startsWith("deliveryPeriod") || dashboardFilter === "dpExpired") {
    const focusTarget =
      dashboardFilter === "deliveryPeriodExtended"
        ? "deliveryperiod:extended"
        : dashboardFilter === "deliveryPeriodExpired" || dashboardFilter === "dpExpired"
          ? "deliveryperiod:expired"
          : "deliveryperiod:valid";
    return { section: "Supply order and payment", milestone: undefined, focusTarget };
  }
  if (
    dashboardFilter.startsWith("delivery") ||
    dashboardFilter.startsWith("jobCompletion") ||
    dashboardFilter === "irPreparationPending" ||
    dashboardFilter === "irReceiptPending" ||
    dashboardFilter === "irCompleted"
  ) {
    const focusTarget =
      dashboardFilter === "dpExpired"
        ? "deliveryperiod:expired"
        : dashboardFilter === "jobCompletionCompleted"
          ? "jobcompletion:completed"
          : dashboardFilter === "jobCompletionDue" || dashboardFilter === "jobCompletionLive"
            ? "jobcompletion:current"
            : dashboardFilter === "jobCompletionPeriodOver"
              ? "jobcompletion:pending"
              : dashboardFilter === "irPreparationPending"
                ? "irpreparation:pending"
                : dashboardFilter === "irReceiptPending" || dashboardFilter === "irCompleted"
                  ? `irreceipt:${dashboardFilter === "irCompleted" ? "completed" : "pending"}`
                  : `delivery:${dashboardFilter.toLowerCase().includes("completed") ? "completed" : dashboardFilter.toLowerCase().includes("overdue") ? "overdue" : "pending"}`;
    return { section: "Supply order and payment", milestone: undefined, focusTarget };
  }
  if (dashboardFilter.startsWith("delayStatus:")) {
    const [, , milestoneKey = "all"] = dashboardFilter.split(":");
    if (milestoneKey === biddingDelayMilestoneKey) {
      return { section: "Bidding details", milestone: undefined, focusTarget: undefined };
    }
    if (milestoneKey === supplementaryBillReturnedDelayMilestoneKey) {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: "supplementarybill:returned",
      };
    }
    const milestone =
      milestoneDefinitions.find((item) => item.key === milestoneKey)?.label ??
      delayStatusMilestoneLabels[milestoneKey];
    if (milestone && isSupplyOrderDrivenMilestoneName(milestone)) {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `${normalizeMilestoneName(milestone)}:pending`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Timeline", milestone, focusTarget: undefined };
  }
  if (dashboardFilter.startsWith("biddingDelay:")) {
    const [, , breakupKey = ""] = dashboardFilter.split(":");
    return {
      section: "Bidding details",
      milestone: undefined,
      focusTarget: getBiddingDelayFocusTarget(breakupKey),
    };
  }
  return { section: "Timeline", milestone: undefined, focusTarget: undefined };
}

function getStatus4CompletedSupplyOrderFocusTarget(milestone: string, metric: string) {
  if (metric !== "cleared") return undefined;
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "financialsanction") return "financialsanction:completed";
  if (normalized === "supplyorder") return "supplyorder:placed";
  return undefined;
}

function parseDestinationFocusTargets(value: string | undefined) {
  const targets = new Map<string, string>();
  if (!value) return targets;
  value.split(",").forEach((entry) => {
    const [rawFileId = "", rawTarget = ""] = entry.split("=");
    const fileId = decodeURIComponent(rawFileId).trim();
    const target = decodeURIComponent(rawTarget).trim();
    if (fileId && target) targets.set(fileId, target);
  });
  return targets;
}

function getBiddingDelayFocusTarget(breakupKey: string) {
  const targets: Record<string, string> = {
    gemUndertakingPending: "gemUndertakingDate",
    rfpVettingInitiationPending: "rfpVettingInitiationDate",
    rfpVettingApprovalPending: "rfpVettingApprovalDate",
    tenderLivePending: "tenderLive",
    bidOpeningOverdue: "bidOpeningDate",
    biddingStageCompletionPending: "biddingStageOver",
  };
  return targets[breakupKey];
}

function getSimpleFileDestinationFocus(dashboardFilter: string) {
  const milestoneByFilter: Record<string, string> = {
    scrutinyCompleted: "Scrutiny",
    scrutinyUnderProgress: "Scrutiny",
    preTcecCompleted: "Pre-TCEC",
    preTcecRemaining: "Pre-TCEC",
    highValueCompleted: "High Value",
    highValueRemaining: "High Value",
    adCompleted: "AD",
    adRemaining: "AD",
    rqaCompleted: "R&QA",
    rqaRemaining: "R&QA",
    ifaCompleted: "IFA",
    ifaRemaining: "IFA",
    cfaCompleted: "CFA",
    soCompleted: "Supply Order",
    soRemaining: "Supply Order",
  };
  const milestone = milestoneByFilter[dashboardFilter];
  if (milestone) {
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return {
        section: "Supply order and payment",
        milestone: undefined,
        focusTarget: `supplyorder:${dashboardFilter === "soRemaining" ? "pending" : "placed"}`,
      };
    }
    const section = getDateFieldSectionForMilestone(milestone);
    if (section) return { section, milestone: undefined, focusTarget: undefined };
    return { section: "Milestones", milestone, focusTarget: undefined };
  }

  const sectionByFilter: Record<string, string> = {
    demandsControlled: "Scrutiny and control",
    tcecFiles: "File details",
    nonTcecFiles: "File details",
    highValueFiles: "File details",
    adYes: "File details",
    rqaVetting: "File details",
    ifaConcurrence: "File details",
    miscDemandCancelled: "File details",
  };
  const section = sectionByFilter[dashboardFilter];
  return section ? { section, milestone: undefined, focusTarget: undefined } : undefined;
}

function getSnapshotAttributeDestinationFocus(dashboardFilter: string) {
  const [, key = ""] = dashboardFilter.split(":");
  const sectionByAttribute: Record<string, string> = {
    tcec: "File details",
    highValue: "File details",
    ad: "File details",
    rqa: "File details",
    ifa: "File details",
    gem: "File details",
    psb: "Supply order and payment",
    bg: "Supply order and payment",
    rfpVetting: "Bidding details",
    refloat: "Bidding details",
    rst: "File details",
  };
  const section = sectionByAttribute[key] ?? "File details";
  const focusTarget =
    section === "Supply order and payment"
      ? key === "psb"
        ? "psb:any"
        : key === "bg"
          ? "securitybg:any"
          : "supplyorder:any"
      : undefined;
  return { section, milestone: undefined, focusTarget };
}

function getSupplyOrderFocusStateForStatusStage(stage: string) {
  const normalized = normalizeStatusStage(stage);
  if (normalized === "total" || normalized === "totalfiles" || normalized === "totalcases") {
    return "any";
  }
  if (normalized === "atpreviousstage" || normalized === "atpreviousstages") return "pending";
  if (normalized === "livemilestone") return "current";
  if (normalized === "milestoneperiodover") return "pending";
  if (normalized === "inprocess") return "current";
  if (normalized === "done") return "completed";
  return normalized || "current";
}

function getDemandProcessingDestinationFocus(filter: string) {
  const [, rawFrom = "", rawTo = ""] = filter.split(":");
  const toField = getDemandProcessingField(decodeStatusFilterPart(rawTo));
  const fromField = getDemandProcessingField(decodeStatusFilterPart(rawFrom));
  const field = toField ?? fromField;
  if (!field) return undefined;
  if (field.scope === "file") {
    return {
      section: getDemandProcessingFileSection(field.group),
      milestone: undefined,
      focusTarget: undefined,
    };
  }
  return {
    section: "Supply order and payment",
    milestone: undefined,
    focusTarget: `${getDemandProcessingFocusKind(field.id)}:any`,
  };
}

function getDemandProcessingFileSection(group: string) {
  if (group === "Scrutiny") return "Scrutiny and control";
  if (group === "TCEC") return "TCEC block";
  if (group === "Approval / vetting") return "Approval block";
  if (group === "Bidding") return "Bidding details";
  return "File details";
}

function getDemandProcessingFocusKind(fieldId: string) {
  if (fieldId.includes("financialSanctionDate")) return "financialsanction";
  if (fieldId.includes("soDate")) return "supplyorder";
  if (fieldId.includes("psb")) return "psb";
  if (fieldId.includes("pwb")) return "pwb";
  if (fieldId.includes("combined")) return "psbpwb";
  if (fieldId.includes("dpDate") || fieldId.includes("revisedDp")) return "deliveryperiod";
  if (fieldId.includes("materialReceiptDate")) return "delivery";
  if (fieldId.includes("irPreparationDate")) return "irpreparation";
  if (fieldId.includes("irReceiptDate")) return "irreceipt";
  if (fieldId.includes("billPreparationDate")) return "billpreparation";
  if (fieldId.includes("billSentForPaymentDate")) return "billsentforpayment";
  if (fieldId.includes("paymentDate")) return "payment";
  if (fieldId.includes("soCancelledDate")) return "socancelled";
  return "supplyorder";
}

function getDateFieldSectionForMilestone(milestone: string | undefined) {
  const normalized = normalizeMilestoneName(milestone);
  if (["scrutiny", "control", "controlling"].includes(normalized)) {
    return "Scrutiny and control";
  }
  if (["tcec", "pretcec", "posttcec", "refloatposttcec"].includes(normalized)) {
    return "TCEC block";
  }
  if (["highvalue", "ad", "rqa", "ifa", "cfa", "cnc"].includes(normalized)) {
    return "Approval block";
  }
  if (["bidding", "refloatbidding", "prebidmeeting", "refloatprebidmeeting"].includes(normalized)) {
    return "Bidding details";
  }
  return undefined;
}

function getCashOutgoFocusTarget(filter: string) {
  if (filter.startsWith("cashOutgo:")) {
    const parsed = readCashOutgoFilter(filter);
    return parsed ? getCashOutgoModeFocusTarget(parsed.mode) : undefined;
  }
  if (!filter.startsWith("cashOutgoAny:")) return undefined;
  const [, rawModes = ""] = filter.split(":");
  const modes = rawModes.split(",").map((mode) => decodeStatusFilterPart(mode));
  for (const mode of [
    "actualThrough",
    "actual",
    "billSentThrough",
    "billSent",
    "supplementaryReturnedBillsPaid",
    "supplementaryReturnedBillsResubmitted",
    "supplementaryPendingReturnedBills",
    "supplementaryReturnedBills",
    "returnedBillsPaid",
    "returnedBillsResubmitted",
    "pendingReturnedBills",
    "returnedBills",
    "billPreparationThrough",
    "billPreparation",
    "expectedReceiptPendingBillThrough",
    "expectedReceiptPendingBill",
    "expectedReceiptThrough",
    "expectedReceipt",
    "expectedDpThrough",
    "expectedDp",
  ]) {
    if (modes.includes(mode)) return getCashOutgoModeFocusTarget(mode);
  }
  return undefined;
}

function getDashboardFilterFileFocusTarget(file: FileRecord, filter: string | undefined) {
  if (filter === "paymentDue" || filter?.startsWith("financeCarryForward:")) {
    return getPaymentLiabilityFocusTarget(file, filter);
  }
  if (!filter?.startsWith("cashOutgo")) return undefined;
  return getCashOutgoFileFocusTarget(file, filter);
}

function getPaymentLiabilityFocusTarget(file: FileRecord, filter: string) {
  const entries = getFinancePaymentLiabilityEntries(file);
  if (filter === "paymentDue") {
    return getSupplementaryLiabilityFocus(
      entries.find((entry) => entry.kind === "supplementary" && entry.pending)?.bill,
    );
  }
  const matchingSupplementary = entries.find(
    (entry) => entry.kind === "supplementary" && isFinanceCarryForwardEntryMatch(entry, filter),
  );
  return getSupplementaryLiabilityFocus(matchingSupplementary?.bill);
}

function getSupplementaryLiabilityFocus(bill: SupplementaryBillDetail | undefined) {
  if (!bill) return undefined;
  if (hasFilledString(bill.paymentDate)) return "supplementarybill:paid";
  if (isSupplementaryBillReturned(bill)) return "supplementarybill:returned";
  if (isSupplementaryBillResubmitted(bill)) return "supplementarybill:resubmitted";
  return "supplementarybill:submitted";
}

function isFinanceCarryForwardEntryMatch(
  entry: ReturnType<typeof getFinancePaymentLiabilityEntries>[number],
  filter: string,
) {
  const [, mode = "", rawSelectedYear = "", rawSourceYear = ""] = filter.split(":");
  const selectedYear = decodeStatusFilterPart(rawSelectedYear);
  const sourceYear = decodeStatusFilterPart(rawSourceYear);
  const range = getFinancialYearDateRange(selectedYear);
  if (!selectedYear || !sourceYear || !range) return false;
  const orderYear = getFinancialYearForDate(entry.sourceDate);
  if (!orderYear) return false;
  const paymentDate = entry.paymentDate;
  const paidInSelectedYear = isDateWithinRange(paymentDate, range);
  const unpaidAtSelectedYearEnd =
    !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
  if (mode === "futureClearedCarryForward") {
    return (
      orderYear === selectedYear &&
      hasFilledString(paymentDate) &&
      isDateAfter(paymentDate, range.end) &&
      getFinancialYearForDate(paymentDate) === sourceYear
    );
  }
  if (orderYear !== sourceYear) return false;
  if (mode === "carryForward") return orderYear === selectedYear && unpaidAtSelectedYearEnd;
  if (mode === "clearedCarryForward") return orderYear < selectedYear && paidInSelectedYear;
  if (mode === "previousCarryForward") return orderYear < selectedYear && unpaidAtSelectedYearEnd;
  return false;
}

function getCashOutgoFileFocusTarget(file: FileRecord, filter: string) {
  if (filter.startsWith("cashOutgo:")) {
    const parsed = readCashOutgoFilter(filter);
    return parsed ? getCashOutgoParsedFileFocusTarget(file, parsed) : undefined;
  }
  if (!filter.startsWith("cashOutgoAny:")) return undefined;
  const [
    ,
    rawModes = "",
    rawMonthKey = "",
    rawOffsetDays = "0",
    rawFromDate = "",
    rawToDate = "",
    rawAsOfDate = "",
  ] = filter.split(":");
  const modes = rawModes
    .split(",")
    .map((mode) => decodeStatusFilterPart(mode).trim())
    .filter(Boolean);
  for (const mode of getCashOutgoFocusPriorityModes()) {
    if (!modes.includes(mode)) continue;
    const modeFilter = [
      "cashOutgo",
      mode,
      rawMonthKey,
      rawOffsetDays,
      rawFromDate,
      rawToDate,
      rawAsOfDate,
    ].join(":");
    if (!isCashOutgoFilterMatch(file, modeFilter)) continue;
    const parsed = readCashOutgoFilter(modeFilter);
    if (!parsed) continue;
    return getCashOutgoParsedFileFocusTarget(file, parsed);
  }
  return undefined;
}

function getCashOutgoFocusPriorityModes() {
  return [
    "actualThrough",
    "actual",
    "billSentThrough",
    "billSent",
    "supplementaryReturnedBillsPaid",
    "supplementaryReturnedBillsResubmitted",
    "supplementaryPendingReturnedBills",
    "supplementaryReturnedBills",
    "returnedBillsPaid",
    "returnedBillsResubmitted",
    "pendingReturnedBills",
    "returnedBills",
    "billPreparationThrough",
    "billPreparation",
    "expectedReceiptPendingBillThrough",
    "expectedReceiptPendingBill",
    "expectedReceiptThrough",
    "expectedReceipt",
    "expectedDpThrough",
    "expectedDp",
  ];
}

function getCashOutgoParsedFileFocusTarget(
  file: FileRecord,
  parsed: NonNullable<ReturnType<typeof readCashOutgoFilter>>,
) {
  return (
    getSupplementaryCashOutgoMatchedFocusTarget(file, parsed) ??
    getCashOutgoModeFocusTarget(parsed.mode)
  );
}

function getSupplementaryCashOutgoMatchedFocusTarget(
  file: FileRecord,
  parsed: NonNullable<ReturnType<typeof readCashOutgoFilter>>,
) {
  if (parsed.mode === "supplementaryBillSent") return "supplementarybill:submitted";
  if (parsed.mode === "supplementaryActual") return "supplementarybill:paid";
  if (parsed.mode === "supplementaryReturnedBills") return "supplementarybill:anyreturned";
  if (parsed.mode === "supplementaryPendingReturnedBills") return "supplementarybill:returned";
  if (parsed.mode === "supplementaryReturnedBillsResubmitted")
    return "supplementarybill:resubmitted";
  if (parsed.mode === "supplementaryReturnedBillsPaid") return "supplementarybill:paid";
  if (
    parsed.mode !== "billPreparation" &&
    parsed.mode !== "billPreparationThrough" &&
    parsed.mode !== "billSent" &&
    parsed.mode !== "billSentThrough" &&
    parsed.mode !== "actual" &&
    parsed.mode !== "actualThrough"
  ) {
    return undefined;
  }

  const throughDate = parsed.mode.endsWith("Through")
    ? (parsed.toDate ?? parsed.asOfDate ?? getMonthEndDateFromMonthKey(parsed.monthKey))
    : undefined;
  const toDate = parsed.toDate ?? parsed.asOfDate;
  const dateMatches = (date: string | undefined) =>
    throughDate
      ? isOnOrBefore(date, throughDate) && dateInRange(date, parsed.fromDate, throughDate)
      : monthMatches(date, parsed.monthKey) && dateInRange(date, parsed.fromDate, parsed.toDate);

  for (const order of filePaymentOrders(file)) {
    if (isSupplyOrderCancelled(file, order)) continue;
    for (const bill of getSupplementaryBills(order)) {
      if (parsed.mode === "billPreparation" || parsed.mode === "billPreparationThrough") {
        if (hasFilledString(bill.paymentDate)) continue;
        const returnedDate = getSupplementaryReturnedBillCashOutgoEventDate(
          bill,
          "supplementaryPendingReturnedBills",
        );
        if (dateMatches(returnedDate)) return "supplementarybill:returned";
      }
      if (parsed.mode === "billSent" || parsed.mode === "billSentThrough") {
        if (hasFilledString(bill.paymentDate) || hasOpenSupplementaryBillReturn(bill)) continue;
        const submissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!hasFilledString(submissionDate)) continue;
        const stateMatches = throughDate
          ? isOnOrBefore(submissionDate, throughDate) &&
            isMissingOrAfter(bill.paymentDate, throughDate)
          : isOnOrBefore(submissionDate, toDate) &&
            (toDate ? isMissingOrAfter(bill.paymentDate, toDate) : true);
        if (stateMatches && dateMatches(submissionDate)) return "supplementarybill:submitted";
      }
      if (parsed.mode === "actual" || parsed.mode === "actualThrough") {
        if (hasFilledString(bill.paymentDate) && dateMatches(bill.paymentDate)) {
          return "supplementarybill:paid";
        }
      }
    }
  }

  return undefined;
}

function getCashOutgoModeFocusTarget(mode: string | undefined) {
  if (mode === "expectedDp" || mode === "expectedDpThrough") return "payment:pending";
  if (mode === "expectedReceipt" || mode === "expectedReceiptThrough") return "payment:pending";
  if (mode === "expectedReceiptPendingBill" || mode === "expectedReceiptPendingBillThrough") {
    return "billpreparation:pending";
  }
  if (mode === "billPreparation" || mode === "billPreparationThrough") {
    return "billsentforpayment:pending";
  }
  if (mode === "billSent" || mode === "billSentThrough") return "payment:pending";
  if (mode === "supplementaryBillSent") return "supplementarybill:submitted";
  if (mode === "supplementaryActual") return "supplementarybill:paid";
  if (mode === "returnedBills") return "billreturnedforcorrection:any";
  if (mode === "pendingReturnedBills") return "billreturnedforcorrection:pending";
  if (mode === "returnedBillsResubmitted") return "billreturnedforcorrection:resubmitted";
  if (mode === "returnedBillsPaid") return "billreturnedforcorrection:paid";
  if (mode === "supplementaryReturnedBills") return "supplementarybill:anyreturned";
  if (mode === "supplementaryPendingReturnedBills") return "supplementarybill:returned";
  if (mode === "supplementaryReturnedBillsResubmitted") return "supplementarybill:resubmitted";
  if (mode === "supplementaryReturnedBillsPaid") return "supplementarybill:paid";
  if (mode === "actual" || mode === "actualThrough") return "payment:completed";
  return undefined;
}

function getSearchCheckboxDestinationFocus(filters: {
  advancePaymentFilter: boolean;
  actualPaymentFilter: boolean;
  stageDeliveryFilter: boolean;
  stagePaymentFilter: boolean;
  dpExtensionFilter: boolean;
  ldFilter: boolean;
}) {
  if (filters.actualPaymentFilter) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "actualpayment:yes",
    };
  }
  if (filters.advancePaymentFilter) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "advancepayment:yes",
    };
  }
  if (filters.stagePaymentFilter) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "stagepayment:yes",
    };
  }
  if (filters.stageDeliveryFilter) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "stagedelivery:yes",
    };
  }
  if (filters.dpExtensionFilter) {
    return {
      section: "Supply order and payment",
      milestone: undefined,
      focusTarget: "dpextension:yes",
    };
  }
  if (filters.ldFilter) {
    return { section: "Supply order and payment", milestone: undefined, focusTarget: "ld:yes" };
  }
  return { section: "Timeline", milestone: undefined, focusTarget: undefined };
}

function getSearchCheckboxFileFocusTarget(
  file: FileRecord,
  filters: {
    actualPaymentFilter: boolean;
  },
) {
  if (filters.actualPaymentFilter && hasSupplementaryActualPaymentOnly(file)) {
    return "supplementarybill:paid";
  }
  return undefined;
}

function hasSupplementaryActualPaymentOnly(file: FileRecord) {
  let hasSupplementaryActual = false;
  for (const order of fileSupplyOrders(file)) {
    if (
      hasNonZeroAmount(order.actualPaymentCapital) ||
      hasNonZeroAmount(order.actualPaymentRevenue)
    ) {
      return false;
    }
    if (
      getSupplementaryBills(order).some(
        (bill) =>
          hasNonZeroAmount(bill.actualPaymentCapital) ||
          hasNonZeroAmount(bill.actualPaymentRevenue),
      )
    ) {
      hasSupplementaryActual = true;
    }
  }
  return hasSupplementaryActual;
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
    if (stageKey === "atpreviousstage") return isFinancialSanctionPreviousStageFile(file);
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

  if (milestoneKey === "supplementarybills") {
    if (stageKey === "submitted") return hasSupplementaryBillPending(file);
    if (stageKey === "returned") return hasSupplementaryBillReturned(file);
    if (stageKey === "resubmitted") return hasSupplementaryBillResubmitted(file);
    if (stageKey === "paid") return hasSupplementaryBillPaid(file);
  }

  if (milestoneKey === "bankguarantee" || isBgMilestoneKey(milestoneKey)) {
    const category = isBgMilestoneKey(milestoneKey) ? milestoneKey : "psb";
    if (stageKey === "total" || stageKey === "totalfiles") {
      return expectedSupplyOrders(file).some(
        (order) =>
          isBgCategoryApplicable(file, order, category) && !isSupplyOrderCancelled(file, order),
      );
    }
    if (stageKey === "received") return isBgReceived(file, category);
    if (stageKey === "pending") return isBgToBeReceived(file, category);
    if (stageKey === "expired") return isBgExpired(file, category);
    if (stageKey === "tobereturned") return isBgToBeReturned(file, category);
    if (stageKey === "returned") return isBgReturned(file, category);
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
    if (stageKey === "done" || stageKey === "completed") return isJobCompletionCompleted(file);
    if (stageKey === "due" || stageKey === "livemilestone") return isJobCompletionLive(file);
    if (stageKey === "milestoneperiodover") return isJobCompletionPeriodOver(file);
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
    return isAtPreviousStageStatusFile(file, milestone);

  return false;
}

function isAtPreviousStageStatusFile(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (!isEligibleMilestone(file, milestone)) return false;
  if (isMilestoneComplete(file, milestone)) return false;
  if (isManualActiveMilestone(file, milestone)) return false;
  if (isMilestoneReviewed(file, milestone)) return false;
  if (milestone.key === "bidding" && (isFileTenderLive(file) || isBidOverdue(file))) return false;
  if (isSupplyOrderDrivenMilestoneName(milestone.label)) {
    if (matchesCurrentSupplyOrderDrivenMilestone(file, milestone.label)) return false;
    if (matchesCompletedSupplyOrderDrivenMilestone(file, milestone.label)) return false;
  }
  return true;
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
  if (normalizedMilestone === "delivery") return isPhysicalDeliveryWorkflow(file);
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

function isFinancialSanctionPreviousStageFile(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  if (matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
  if (matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  if (isYes(file.tcec)) return current === "cnc" && !hasFilledString(file.cncApprovalDate);
  return isBiddingApplicableForFile(file)
    ? current === "bidding" && !isYes(file.biddingStageOver)
    : current === "cfa" && !hasFilledString(file.cfaDate);
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
          : order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)),
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

function formatAmountValue(value: string | undefined) {
  const amount = parseAmount(value);
  if (amount === undefined) return value ?? "";
  return formatThousandsAndLakhs(amount);
}

function getFileAmountFieldValue(
  file: FileRecord,
  key: "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue",
) {
  const pairedKey = getPairedAmountKey(key);
  if (!hasNonZeroAmount(file[key]) && hasNonZeroAmount(file[pairedKey])) return "-";
  return key === "valueCapital" || key === "valueRevenue"
    ? formatInrAmountValue(file[key], file)
    : formatAmountValue(file[key]);
}

function getSupplyOrderAmountFieldValue(
  order: SupplyOrderDetail,
  key: "soValueCapital" | "soValueRevenue",
) {
  const pairedKey = key === "soValueCapital" ? "soValueRevenue" : "soValueCapital";
  if (!hasNonZeroAmount(order[key]) && hasNonZeroAmount(order[pairedKey])) return "-";
  return formatAmountValue(order[key]);
}

function getPairedAmountKey(
  key: "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue",
): "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue" {
  if (key === "valueCapital") return "valueRevenue";
  if (key === "valueRevenue") return "valueCapital";
  if (key === "soValueCapital") return "soValueRevenue";
  return "soValueCapital";
}

function formatInrAmountValue(value: string | undefined, file: FileRecord) {
  const amount = getInrAmount(value, file);
  if (amount === undefined) return "";
  return formatThousandsAndLakhs(amount);
}

function isAmountField(key: string) {
  return [
    "valueCapital",
    "valueRevenue",
    "soValueCapital",
    "soValueRevenue",
    "exchangeRate",
  ].includes(key);
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

function sortFiles(
  files: FileRecord[],
  sortColumnKey: string,
  divisionWiseSort: boolean,
  sortDirection: SortDirection,
) {
  const indexed = files.map((file, index) => ({ file, index }));
  const sorted = [...indexed].sort((a, b) => {
    if (divisionWiseSort) {
      const divisionCompare = compareSortValues(a.file.division, b.file.division);
      if (divisionCompare !== 0) return divisionCompare;
    }

    if (sortColumnKey !== "none") {
      const columnCompare = compareSortValues(
        String(getSortColumnValue(a.file, sortColumnKey) ?? ""),
        String(getSortColumnValue(b.file, sortColumnKey) ?? ""),
      );
      if (columnCompare !== 0) return sortDirection === "asc" ? columnCompare : -columnCompare;
    }

    return a.index - b.index;
  });

  return sorted.map(({ file }) => file);
}

function getSortColumnValue(file: FileRecord, key: string) {
  const column = printColumns.find((item) => item.key === key);
  if (column) return column.getValue(file);
  return isSupplyOrderKey(key) ? getSupplyOrderFieldValue(file, key) : file[key as FileKey];
}

function compareSortValues(a: string | undefined, b: string | undefined) {
  const aValue = (a ?? "").trim();
  const bValue = (b ?? "").trim();
  if (!aValue && !bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return sortCollator.compare(aValue, bValue);
}

function allSearchText(file: FileRecord) {
  const directText = editableFields
    .map((field) => {
      return isSupplyOrderKey(field.key)
        ? getSupplyOrderFieldValue(file, field.key as SupplyOrderKey)
        : file[field.key];
    })
    .filter(Boolean)
    .join(" ");
  const supplyOrderText = fileSupplyOrders(file)
    .flatMap((order) => Object.values(order))
    .filter(Boolean)
    .join(" ");
  const newRemarkText =
    file.remarks?.map((remark) => `${remark.section} ${remark.text}`).join(" ") ?? "";
  const markerText = file.markers?.map((marker) => marker.text).join(" ") ?? "";
  const firmText = [getFirmCount(file.invitedFirms), getFirmCount(file.bidderFirms)].join(" ");
  return `${directText} ${supplyOrderText} ${newRemarkText} ${markerText} ${firmText}`.toLowerCase();
}

function getRecentRemarks(file: FileRecord) {
  const datedRemarks =
    file.remarks
      ?.map((remark) => ({
        label: `${remark.section} remark`,
        createdAt: remark.createdAt,
        value: remark.text,
      }))
      .filter((remark) => remark.value.trim()) ?? [];
  return datedRemarks
    .slice(-2)
    .reverse()
    .map((remark) => ({
      label: `${remark.label} (${formatRemarkDate(remark.createdAt)})`,
      value: remark.value,
    }));
}

function formatRemarkDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function printFile(file: FileRecord) {
  const title = file.uniqueCode || file.imms || "File record";
  void downloadBackendExport({
    format: "pdf",
    title: "FileHistory File Record",
    subtitle: `Unique code: ${file.uniqueCode || ""}`,
    fileName: `${getExportFileName(title)}.pdf`,
    tables: fieldSections.map((section) => ({
      title: section.title,
      headers: ["S.No.", "Field", "Value"],
      rows: section.fields.map((field, index) => {
        const value = printColumns.find((column) => column.key === field.key)?.getValue(file);
        return [index + 1, field.label, value || ""];
      }),
    })),
  });
}

function printVisibleFile(file: FileRecord, columns: PrintColumn[]) {
  if (columns.length === 0) {
    alert("Select at least one table field to print.");
    return;
  }

  const title = file.uniqueCode || file.imms || "File record";
  const table = buildSearchExportTable([file], columns, "rowwise");
  void downloadBackendExport({
    format: "pdf",
    title: "FileHistory File Record",
    subtitle: `Unique code: ${file.uniqueCode || ""}`,
    fileName: `${getExportFileName(title)}.pdf`,
    tables: [
      {
        headers: table.headers,
        rows: table.rows,
      },
    ],
  });
}

function printSearchList(
  files: FileRecord[],
  columns: PrintColumn[],
  searchFilterQuery?: string,
  layout: FileSearchExportLayout = "rowwise",
) {
  if (files.length === 0) {
    alert("No searched files to print.");
    return;
  }

  if (columns.length === 0) {
    alert("Select at least one table field to print.");
    return;
  }

  if (searchFilterQuery) {
    void downloadFilteredSearchList(searchFilterQuery, columns, "pdf", layout);
    return;
  }

  void downloadSearchList(files, columns, "pdf", layout);
}

function exportSearchList(
  files: FileRecord[],
  columns: PrintColumn[],
  layout: FileSearchExportLayout = "rowwise",
) {
  if (files.length === 0) {
    alert("No searched files to export.");
    return;
  }

  if (columns.length === 0) {
    alert("Select at least one table field to export.");
    return;
  }

  void downloadSearchList(files, columns, "excel", layout);
}

async function downloadSearchList(
  files: FileRecord[],
  columns: PrintColumn[],
  format: "excel" | "pdf",
  layout: FileSearchExportLayout = "rowwise",
) {
  const table = buildSearchExportTable(files, columns, layout);
  await downloadBackendExport({
    format,
    title: "FileHistory Search Results",
    description: `Files: ${files.length}; Layout: ${formatSearchExportLayout(layout)}`,
    fileName: `filehistory-search-results-${new Date().toISOString().slice(0, 10)}.${format === "excel" ? "xls" : "pdf"}`,
    tables: [
      {
        headers: table.headers,
        rows: table.rows,
      },
    ],
  });
}

function buildSearchExportTable(
  files: FileRecord[],
  columns: PrintColumn[],
  layout: FileSearchExportLayout,
): SearchExportTable {
  if (layout === "rowwise") return buildRowwiseSearchExportTable(files, columns);
  const exportColumns = buildSearchExportColumns(files, columns);
  return {
    headers: ["S.No.", ...exportColumns.map((column) => column.label)],
    rows: files.map((file, index) => [
      index + 1,
      ...exportColumns.map((column) => column.getValue(file) || ""),
    ]),
  };
}

function buildRowwiseSearchExportTable(
  files: FileRecord[],
  columns: PrintColumn[],
): SearchExportTable {
  const fileColumns = columns.filter((column) => !isSupplyOrderKey(column.key));
  const supplyOrderColumns = columns.filter((column) => isSupplyOrderKey(column.key));
  const headers = [
    "S.No.",
    ...fileColumns.map((column) => column.label),
    "S.O.",
    "Delivery stage",
    "Supplementary bill",
    "Bill return cycle",
    ...supplyOrderColumns.flatMap((column) => getRowwiseSupplyOrderExportHeaders(column)),
  ];
  const rows: Array<Array<string | number>> = [];
  files.forEach((file) => {
    const rowEntries = getRowwiseSearchExportEntries(file, supplyOrderColumns);
    rowEntries.forEach((entry, entryIndex) => {
      rows.push([
        rows.length + 1,
        ...fileColumns.map((column) => (entryIndex === 0 ? column.getValue(file) || "" : "")),
        entry.order && isFirstRowwiseOrderRow(entry) ? String(entry.orderIndex + 1) : "",
        entry.stage ? `Delivery-${entry.stageIndex + 1}` : "",
        entry.supplementaryBill ? String(entry.supplementaryBillIndex + 1) : "",
        entry.billReturnCycle ? String(entry.billReturnCycleIndex + 1) : "",
        ...supplyOrderColumns.flatMap((column) =>
          getRowwiseSupplyOrderExportValues(file, column.key as SupplyOrderKey, entry),
        ),
      ]);
    });
  });
  return { headers, rows };
}

type RowwiseSearchExportEntry = {
  order?: SupplyOrderDetail;
  orderIndex: number;
  stage?: NonNullable<SupplyOrderDetail["stageDeliveries"]>[number];
  stageIndex: number;
  supplementaryBill?: SupplementaryBillDetail;
  supplementaryBillIndex: number;
  billReturnCycle?: BillReturnCycle;
  billReturnCycleIndex: number;
};

function getRowwiseSearchExportEntries(
  file: FileRecord,
  supplyOrderColumns: PrintColumn[],
): RowwiseSearchExportEntry[] {
  const orders = rawSupplyOrders(file);
  if (!orders.length) {
    return [
      { orderIndex: -1, stageIndex: -1, supplementaryBillIndex: -1, billReturnCycleIndex: -1 },
    ];
  }
  const needsSupplementaryRows = supplyOrderColumns.some((column) =>
    supplementaryBillTableKeys.has(column.key),
  );
  const needsBillReturnRows = supplyOrderColumns.some(
    (column) => column.key === "billReturnCycles",
  );
  return orders.flatMap((order, orderIndex) => {
    const entries: RowwiseSearchExportEntry[] = [];
    if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
      entries.push(
        ...order.stageDeliveries.map((stage, stageIndex) => ({
          order,
          orderIndex,
          stage,
          stageIndex,
          supplementaryBillIndex: -1,
          billReturnCycleIndex: -1,
        })),
      );
    } else {
      entries.push({
        order,
        orderIndex,
        stageIndex: -1,
        supplementaryBillIndex: -1,
        billReturnCycleIndex: -1,
      });
    }

    if (needsBillReturnRows) {
      normalizeBillReturnCycles(order.billReturnCycles).forEach(
        (billReturnCycle, billReturnCycleIndex) => {
          entries.push({
            order,
            orderIndex,
            stageIndex: -1,
            supplementaryBillIndex: -1,
            billReturnCycle,
            billReturnCycleIndex,
          });
        },
      );
    }

    if (needsSupplementaryRows) {
      normalizeSupplementaryBillsForTable(order.supplementaryBills).forEach(
        (supplementaryBill, supplementaryBillIndex) => {
          const cycles = normalizeBillReturnCycles(supplementaryBill.billReturnCycles);
          if (
            cycles.length &&
            supplyOrderColumns.some((column) => column.key === "supplementaryBillReturnCycles")
          ) {
            cycles.forEach((billReturnCycle, billReturnCycleIndex) => {
              entries.push({
                order,
                orderIndex,
                stageIndex: -1,
                supplementaryBill,
                supplementaryBillIndex,
                billReturnCycle,
                billReturnCycleIndex,
              });
            });
            return;
          }
          entries.push({
            order,
            orderIndex,
            stageIndex: -1,
            supplementaryBill,
            supplementaryBillIndex,
            billReturnCycleIndex: -1,
          });
        },
      );
    }

    return entries;
  });
}

function getRowwiseSupplyOrderExportHeaders(column: PrintColumn) {
  if (column.key === "billReturnCycles") {
    return [
      "Bill returned date",
      "Bill return reason",
      "Bill resubmitted date",
      "Bill return remarks",
    ];
  }
  if (column.key === "supplementaryBillReturnCycles") {
    return [
      "Supplementary bill returned date",
      "Supplementary bill return reason",
      "Supplementary bill resubmitted date",
      "Supplementary bill return remarks",
    ];
  }
  if (column.key === "supplementaryBills") {
    return [
      "Supplementary Bill No.",
      "Supplementary bill amount (Capital)",
      "Supplementary bill amount (Revenue)",
      "Supplementary bill sent for payment",
      "Supplementary payment date",
      "Supplementary payment mode",
      "Supplementary actual payment amount (Capital)",
      "Supplementary actual payment amount (Revenue)",
      "Supplementary bill remarks",
    ];
  }
  return [column.label];
}

function getRowwiseSupplyOrderExportValues(
  file: FileRecord,
  key: SupplyOrderKey,
  entry: RowwiseSearchExportEntry,
) {
  if (!entry.order) return getEmptyRowwiseSupplyOrderExportValues(key);
  if (key === "billReturnCycles") return getBillReturnCycleExportValues(entry.billReturnCycle);
  if (key === "supplementaryBillReturnCycles") {
    return getBillReturnCycleExportValues(
      entry.supplementaryBill ? entry.billReturnCycle : undefined,
    );
  }
  if (key === "supplementaryBills") {
    return getSupplementaryBillExportValues(entry.supplementaryBill);
  }
  if (supplementaryBillTableKeys.has(key)) {
    return [
      entry.supplementaryBill ? getSupplementaryBillSingleValue(entry.supplementaryBill, key) : "",
    ];
  }
  if (entry.stage && shouldUseStageValueForRowwiseExport(entry.order, key)) {
    return [getStageSupplyOrderExportValueFromStage(entry.stage, key, entry.stageIndex)];
  }
  if (!isFirstRowwiseOrderRow(entry)) return [""];
  return [getSupplyOrderValue(entry.order, key)];
}

function getEmptyRowwiseSupplyOrderExportValues(key: SupplyOrderKey) {
  if (key === "billReturnCycles" || key === "supplementaryBillReturnCycles") {
    return ["", "", "", ""];
  }
  if (key === "supplementaryBills") return Array.from({ length: 9 }, () => "");
  return [""];
}

function getBillReturnCycleExportValues(cycle: BillReturnCycle | undefined) {
  return [
    cycle?.returnedDate ? formatIsoDateForDisplay(cycle.returnedDate) : "",
    cycle?.reason ?? "",
    cycle?.resubmittedDate ? formatIsoDateForDisplay(cycle.resubmittedDate) : "",
    cycle?.remarks ?? "",
  ];
}

function getSupplementaryBillExportValues(bill: SupplementaryBillDetail | undefined) {
  return [
    bill?.billNo ?? "",
    bill?.billAmountCapital ?? "",
    bill?.billAmountRevenue ?? "",
    bill?.billSentForPaymentDate ? formatIsoDateForDisplay(bill.billSentForPaymentDate) : "",
    bill?.paymentDate ? formatIsoDateForDisplay(bill.paymentDate) : "",
    bill?.paymentMode ?? "",
    bill?.actualPaymentCapital ?? "",
    bill?.actualPaymentRevenue ?? "",
    bill?.remarks ?? "",
  ];
}

function getSupplementaryBillSingleValue(bill: SupplementaryBillDetail, key: SupplyOrderKey) {
  if (key === "supplementaryBillNo") return bill.billNo ?? "";
  if (key === "supplementaryBillAmountCapital") return bill.billAmountCapital ?? "";
  if (key === "supplementaryBillAmountRevenue") return bill.billAmountRevenue ?? "";
  if (key === "supplementaryBillSentForPaymentDate") {
    return bill.billSentForPaymentDate ? formatIsoDateForDisplay(bill.billSentForPaymentDate) : "";
  }
  if (key === "supplementaryBillPaymentDate") {
    return bill.paymentDate ? formatIsoDateForDisplay(bill.paymentDate) : "";
  }
  if (key === "supplementaryBillPaymentMode") return bill.paymentMode ?? "";
  if (key === "supplementaryBillActualPaymentCapital") return bill.actualPaymentCapital ?? "";
  if (key === "supplementaryBillActualPaymentRevenue") return bill.actualPaymentRevenue ?? "";
  if (key === "supplementaryBillRemarks") return bill.remarks ?? "";
  return "";
}

function isFirstRowwiseOrderRow(entry: RowwiseSearchExportEntry) {
  return entry.stageIndex <= 0;
}

function shouldUseStageValueForRowwiseExport(order: SupplyOrderDetail, key: SupplyOrderKey) {
  if (stagedDeliveryWorkflowKeys.has(key)) return true;
  if (stagedPaymentWorkflowKeys.has(key)) return isYes(order.stagePayment);
  return false;
}

function buildSearchExportColumns(files: FileRecord[], columns: PrintColumn[]) {
  const maxSupplyOrders = Math.max(1, ...files.map((file) => rawSupplyOrders(file).length));
  return columns.flatMap((column) => {
    if (!isSupplyOrderKey(column.key)) return [column];
    const key = column.key;
    const maxStageCounts = Array.from({ length: maxSupplyOrders }, (_, orderIndex) =>
      Math.max(
        0,
        ...files.map((file) => rawSupplyOrders(file)[orderIndex]?.stageDeliveries?.length ?? 0),
      ),
    );
    return Array.from({ length: maxSupplyOrders }, (_, orderIndex) => {
      const orderNumber = orderIndex + 1;
      const mainColumn: PrintColumn = {
        key: `${column.key}:so${orderNumber}`,
        label: `S.O. ${orderNumber} ${column.label}`,
        getValue: (file) => getMainSupplyOrderExportValue(file, key, orderIndex),
      };
      if (!stagedSupplyOrderExportKeys.has(column.key)) return [mainColumn];
      const stageColumns = Array.from({ length: maxStageCounts[orderIndex] }, (_, stageIndex) => ({
        key: `${column.key}:so${orderNumber}:delivery${stageIndex + 1}`,
        label: `S.O. ${orderNumber} Delivery-${stageIndex + 1} ${column.label}`,
        getValue: (file: FileRecord) =>
          getStageSupplyOrderExportValue(file, key, orderIndex, stageIndex),
      }));
      return [mainColumn, ...stageColumns];
    }).flat();
  });
}

function getMainSupplyOrderExportValue(file: FileRecord, key: SupplyOrderKey, orderIndex: number) {
  const order = rawSupplyOrders(file)[orderIndex];
  if (!order) return "";
  return getSupplyOrderValue(order, key);
}

function getStageSupplyOrderExportValue(
  file: FileRecord,
  key: SupplyOrderKey,
  orderIndex: number,
  stageIndex: number,
) {
  const stage = rawSupplyOrders(file)[orderIndex]?.stageDeliveries?.[stageIndex];
  if (!stage) return "";
  return getStageSupplyOrderExportValueFromStage(stage, key, stageIndex);
}

function getStageSupplyOrderExportValueFromStage(
  stage: NonNullable<SupplyOrderDetail["stageDeliveries"]>[number],
  key: SupplyOrderKey,
  stageIndex: number,
) {
  if (key === "stageAmountCapital") return String(stage.stageAmountCapital ?? "");
  if (key === "stageAmountRevenue") return String(stage.stageAmountRevenue ?? "");
  if (key === "stageDeliveryLabel") return `Delivery-${stageIndex + 1}`;
  const value = String(stage[key as keyof typeof stage] ?? "");
  return isSupplyOrderDateField(key) ? formatIsoDateForDisplay(value) : value;
}

function isSupplyOrderDateField(key: SupplyOrderKey) {
  return supplyOrderDateKeys.has(key);
}

async function downloadFilteredSearchList(
  searchFilterQuery: string,
  columns: PrintColumn[],
  format: "excel" | "pdf",
  layout: FileSearchExportLayout = "rowwise",
) {
  const query = Object.fromEntries(new URLSearchParams(searchFilterQuery));
  await downloadBackendFileSearchExport({
    format,
    title: "FileHistory Search Results",
    columns: columns.map((column) => ({ key: column.key, label: column.label })),
    query,
    layout,
  });
}

function formatSearchExportLayout(layout: FileSearchExportLayout) {
  return layout === "rowwise" ? "Rowwise" : "Columnwise";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getValueTotals(
  files: FileRecord[],
  dashboardFilter?: string,
  valueThresholdLevels: ValueThresholdLevel[] = [],
) {
  if (isSupplyOrderValueDashboardFilter(dashboardFilter)) {
    return getSupplyOrderValueTotals(files, dashboardFilter, valueThresholdLevels);
  }
  const totals = files.reduce(
    (current, file) => {
      current.capital += getInrAmount(file.valueCapital, file) ?? 0;
      current.revenue += getInrAmount(file.valueRevenue, file) ?? 0;
      return current;
    },
    { capital: 0, revenue: 0 },
  );
  return { ...totals, total: totals.capital + totals.revenue };
}

function isSupplyOrderValueDashboardFilter(dashboardFilter: string | undefined) {
  return Boolean(
    dashboardFilter &&
    (dashboardFilter.startsWith("supplyOrderMonth:") ||
      dashboardFilter.startsWith("supplyOrderYear:") ||
      dashboardFilter.startsWith("deliverySchedule:") ||
      dashboardFilter.startsWith("deliveryScheduleYear:") ||
      dashboardFilter.startsWith("completedDeliveryMonth:") ||
      dashboardFilter.startsWith("completedDeliveryYear:") ||
      dashboardFilter.startsWith("soValueThreshold:")),
  );
}

function getSupplyOrderValueTotals(
  files: FileRecord[],
  dashboardFilter: string | undefined,
  valueThresholdLevels: ValueThresholdLevel[],
) {
  const totals = files.reduce(
    (current, file) => {
      getContributingValueOrders(file, dashboardFilter, valueThresholdLevels).forEach((order) => {
        current.capital += getInrAmount(order.soValueCapital, file) ?? 0;
        current.revenue += getInrAmount(order.soValueRevenue, file) ?? 0;
      });
      return current;
    },
    { capital: 0, revenue: 0 },
  );
  return { ...totals, total: totals.capital + totals.revenue };
}

function getContributingValueOrders(
  file: FileRecord,
  dashboardFilter: string | undefined,
  valueThresholdLevels: ValueThresholdLevel[] = [],
) {
  if (!dashboardFilter) return [];
  if (dashboardFilter.startsWith("supplyOrderMonth:")) {
    const monthKey = dashboardFilter.slice("supplyOrderMonth:".length);
    return rawSupplyOrders(file).filter(
      (order) => !isSupplyOrderCancelled(file, order) && order.soDate?.slice(0, 7) === monthKey,
    );
  }
  if (dashboardFilter.startsWith("supplyOrderYear:")) {
    const yearKey = dashboardFilter.slice("supplyOrderYear:".length);
    return rawSupplyOrders(file).filter(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasFilledString(order.soDate) &&
        (yearKey === "all" || order.soDate!.slice(0, 4) === yearKey),
    );
  }
  if (dashboardFilter.startsWith("deliverySchedule:")) {
    const [, mode = "gross", monthKey = ""] = dashboardFilter.split(":");
    return fileSupplyOrders(file).filter(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        getDeliveryPeriodDate(order)?.slice(0, 7) === monthKey &&
        (mode !== "net" || !isDeliveryFructified(file, order)),
    );
  }
  if (dashboardFilter.startsWith("deliveryScheduleYear:")) {
    const [, mode = "gross", yearKey = ""] = dashboardFilter.split(":");
    return fileSupplyOrders(file).filter((order) => {
      const deliveryDate = getDeliveryPeriodDate(order);
      return (
        !isSupplyOrderCancelled(file, order) &&
        hasFilledString(deliveryDate) &&
        (yearKey === "all" || deliveryDate!.slice(0, 4) === yearKey) &&
        (mode !== "net" || !isDeliveryFructified(file, order))
      );
    });
  }
  if (dashboardFilter.startsWith("completedDeliveryMonth:")) {
    const monthKey = dashboardFilter.slice("completedDeliveryMonth:".length);
    return fileSupplyOrders(file).filter(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        getDeliveryCompletionMonthDate(file, order)?.slice(0, 7) === monthKey,
    );
  }
  if (dashboardFilter.startsWith("completedDeliveryYear:")) {
    const yearKey = dashboardFilter.slice("completedDeliveryYear:".length);
    return fileSupplyOrders(file).filter((order) => {
      const completionDate = getDeliveryCompletionMonthDate(file, order);
      return (
        !isSupplyOrderCancelled(file, order) &&
        hasFilledString(completionDate) &&
        (yearKey === "all" || completionDate!.slice(0, 4) === yearKey)
      );
    });
  }
  if (dashboardFilter.startsWith("soValueThreshold:")) {
    const { label, metric } = parseValueThresholdDashboardFilter(
      dashboardFilter,
      "soValueThreshold:",
    );
    return rawSupplyOrders(file).filter((order) =>
      isSupplyOrderValueThresholdMatch(file, order, label, valueThresholdLevels, metric),
    );
  }
  return [];
}

function isSupplyOrderValueThresholdMatch(
  file: FileRecord,
  order: SupplyOrderDetail,
  label: string,
  levels: ValueThresholdLevel[],
  metric?: string,
) {
  if (isSupplyOrderCancelled(file, order)) return false;
  const capital = getInrAmount(order.soValueCapital, file) ?? 0;
  const revenue = getInrAmount(order.soValueRevenue, file) ?? 0;
  const valueType = capital > 0 ? "capital" : revenue > 0 ? "revenue" : undefined;
  const amount = valueType === "capital" ? capital : valueType === "revenue" ? revenue : 0;
  if (!valueType || amount <= 0) return false;
  if ((metric === "capital" || metric === "revenue") && valueType !== metric) return false;
  const match = levels.find((level) => isValueThresholdLevelMatch(level, valueType, amount));
  if (label.toLowerCase() === "unmatched") return !match;
  return (match?.label ?? "").trim().toLowerCase() === label.trim().toLowerCase();
}

function isValueThresholdLevelMatch(
  level: ValueThresholdLevel,
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

function formatCurrency(value: number) {
  return formatThousandsAndLakhs(value);
}
