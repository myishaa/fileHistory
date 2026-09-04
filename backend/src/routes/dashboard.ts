import { Router } from "express";
import { pool } from "../db/pool.js";
import { ensureSupplyOrderBillReturnsSchema, loadFiles } from "./files.js";
import type {
  AppSettings,
  Division,
  FileRecord,
  SupplyOrderDetail,
  ValueThresholdLevel,
} from "../types.js";
import { fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { buildDashboardSummary } from "../utils/dashboard-summary.js";
import { effectiveSupplyOrderEntries } from "../utils/effective-deliveries.js";
import {
  isBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "../utils/file-type-groups.js";
import {
  matchesFileCategorySelection,
  normalizeFileCategories,
  type FileCategoryKey,
} from "../utils/file-categories.js";
import {
  canUseAllDivisions,
  getAuthScopeCacheKey,
  getDivisionScopeCondition,
  getFileCategoryScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { cacheTtl, clearDashboardReportCaches, getCached } from "../utils/cache.js";
import { asyncHandler, HttpError } from "../utils/http.js";

export const dashboardRouter = Router();

let anomalyGovernanceSchemaReady: Promise<void> | undefined;

function hasAnomalyAdminAccess(user: { role: string }) {
  return user.role === "admin" || user.role === "sub_admin";
}

function hasAnomalyGovernanceReadAccess(user: { role: string }) {
  return hasAnomalyAdminAccess(user) || user.role === "universal_viewer";
}

type DivisionRow = {
  id: string;
  name: string;
  code: string | null;
  allocated_capital: string | null;
  allocated_revenue: string | null;
  ad: string | null;
};

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  year_selection_locked: boolean;
  theme: AppSettings["theme"];
  theme_tint: AppSettings["themeTint"];
  deletion_password: string;
  tcec_committees: unknown;
  firm_types: unknown;
  file_types: unknown;
  file_type_groups: unknown;
  modes: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  active_user_id: string | null;
};

const defaultModeNames = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const snapshotAttributeDefinitions = [
  { key: "tcec", column: "f.tcec", label: "TCEC", yesLabel: "TCEC", noLabel: "Non TCEC" },
  { key: "gte", column: "f.gte", label: "GTE", yesLabel: "GTE", noLabel: "Non GTE" },
  { key: "gem", column: "f.gem", label: "GeM", yesLabel: "GeM", noLabel: "Non GeM" },
  {
    key: "highValue",
    column: "f.high_value",
    label: "High Value",
    yesLabel: "High Value",
    noLabel: "Non High Value",
  },
  { key: "ad", column: "f.ad", label: "AD", yesLabel: "AD", noLabel: "Non AD" },
  { key: "rqa", column: "f.rqa", label: "R&QA", yesLabel: "R&QA", noLabel: "Non R&QA" },
  { key: "ifa", column: "f.ifa", label: "IFA", yesLabel: "IFA", noLabel: "Non IFA" },
  {
    key: "psb",
    condition: `exists (
      select 1 from supply_orders so
      where so.file_id = f.id
        and not ${isYesExpression("so.so_cancelled")}
        and ${isYesExpression("so.psb_applicable")}
        and trim(coalesce(so.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')
    )`,
    label: "PSB",
    yesLabel: "PSB",
    noLabel: "Non PSB",
  },
  { key: "bg", column: "f.bg", label: "Warranty", yesLabel: "Warranty", noLabel: "Non Warranty" },
  {
    key: "rfpVetting",
    column: "f.rfp_vetting",
    label: "RFP vetting",
    yesLabel: "RFP vetting",
    noLabel: "Non RFP vetting",
  },
  {
    key: "refloat",
    column: "f.refloat",
    label: "Refloat",
    yesLabel: "Refloat",
    noLabel: "Non Refloat",
  },
  { key: "rst", column: "f.rst", label: "RST", yesLabel: "RST", noLabel: "Non RST" },
] as const;

const statusMilestoneDefinitions = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    reviewedColumn: "f.scrutiny_date",
    currentColumn: "f.scrutiny_completion_date",
  },
  {
    key: "highValue",
    label: "High Value",
    reviewedColumn: "f.high_value_meeting_date",
    currentColumn: "f.high_value_minutes_date",
    appliesColumn: "f.high_value",
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    reviewedColumn: "f.pre_tcec_date",
    currentColumn: "f.pre_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "ad",
    label: "AD",
    reviewedColumn: "f.ad_sent_date",
    currentColumn: "f.ad_vetting_date",
    appliesColumn: "f.ad",
  },
  {
    key: "rqa",
    label: "R&QA",
    reviewedColumn: "f.rqa_sent_date",
    currentColumn: "f.rqa_approval_date",
    appliesColumn: "f.rqa",
  },
  {
    key: "control",
    label: "Controlling",
    currentColumn: "f.imms_date",
    aliases: ["Controlling", "Controlled"],
  },
  {
    key: "ifa",
    label: "IFA",
    reviewedColumn: "f.ifa_sent_date",
    currentColumn: "f.ifa_final_date",
    appliesColumn: "f.ifa",
  },
  {
    key: "cfa",
    label: "CFA",
    reviewedColumn: "f.cfa_sent_date",
    currentColumn: "f.cfa_date",
  },
  { key: "bidding", label: "Bidding", currentColumn: "f.bidding_stage_over", yesComplete: true },
  {
    key: "postTcec",
    label: "Post-TCEC",
    reviewedColumn: "f.post_tcec_date",
    currentColumn: "f.post_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "refloatBidding",
    label: "Refloat bidding",
    currentColumn: "f.bidding_stage_over",
    appliesColumn: "f.refloat",
    yesComplete: true,
  },
  {
    key: "refloatPostTcec",
    label: "Refloat Post-TCEC",
    reviewedColumn: "f.refloat_post_tcec_date",
    currentColumn: "f.refloat_post_tcec_minutes_date",
    appliesColumn: "f.refloat",
  },
  {
    key: "cnc",
    label: "CNC",
    reviewedColumn: "f.cnc_date",
    currentColumn: "f.cnc_approval_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "financialSanction",
    label: "Financial Sanction",
    supplyOrderDate: "financial_sanction_date",
  },
  { key: "supplyOrder", label: "Supply Order", supplyOrderDate: "so_date" },
  {
    key: "psb",
    label: "PSB",
    supplyOrderDate: "psb_bg_received_date",
  },
  {
    key: "pwb",
    label: "PWB",
    appliesColumn: "f.bg",
    supplyOrderDate: "pwb_bg_received_date",
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    appliesColumn: "f.bg",
    supplyOrderDate: "combined_bg_received_date",
  },
  { key: "payment", label: "Payment", supplyOrderDate: "payment_date" },
] as const;

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
  "Refloat bidding",
  "Refloat Post-TCEC",
  "CNC",
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Job Completion",
  "Bill sent for payment",
  "Bill returned for correction",
  "Supplementary bill returned for correction",
  "Advance Payment",
  "Payment",
];
const gemBiddingModeOptions = ["Custom", "Catalogue", "Comparison"];

function mapDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    name: row.name,
    code: fromDbText(row.code),
    allocatedCapital: fromDbText(row.allocated_capital),
    allocatedRevenue: fromDbText(row.allocated_revenue),
    ad: fromDbText(row.ad),
  };
}

function mapSettings(row: SettingsRow): AppSettings {
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: [row.financial_year, row.selected_year].filter(
      (year) =>
        Boolean(year) &&
        year !== "__all_active_files__" &&
        year !== "__active_plus_current_fy_closed__",
    ),
    yearSelectionLocked: row.year_selection_locked,
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: fromDbJsonArray(row.tcec_committees) as string[],
    firmTypes: fromDbJsonArray(row.firm_types) as string[],
    fileTypes: fromDbJsonArray(row.file_types) as string[],
    fileTypeGroups: fromDbJsonArray(row.file_type_groups) as AppSettings["fileTypeGroups"],
    modes: fromDbJsonArray(row.modes) as string[],
    valueThresholdLevels: [],
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: fromDbJsonArray(row.table_field_presets),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

function getSuspectedAnomalyRows(
  files: FileRecord[],
  suppressions: AnomalySuppressions,
  customRules: CustomAnomalyRule[] = [],
): SuspectedAnomalyRow[] {
  const rows: SuspectedAnomalyRow[] = [];
  const emittedAnomalyKeys = new Set<string>();
  const activeFiles = files.filter((file) => !isInactiveFile(file));
  const duplicateFileRefs = getDuplicateValues(
    activeFiles.flatMap((file) => [file.uniqueCode, file.fileNo]),
  );
  const duplicateBgNumbers = getDuplicateValues(
    activeFiles.flatMap((file) =>
      fileSupplyOrders(file).flatMap((order) => [order.psbBgNo, order.pwbBgNo, order.combinedBgNo]),
    ),
  );
  files.forEach((file) => {
    const addPair = (
      block: string,
      rule: string,
      previousField: string,
      previousDate: string | undefined,
      laterField: string,
      laterDate: string | undefined,
      context = "file",
    ) => {
      if (!isIsoDate(previousDate) || !isIsoDate(laterDate) || previousDate! <= laterDate!) return;
      const ruleKey = normalizeAnomalyKey(rule);
      const signature = [
        file.id,
        context,
        ruleKey,
        previousField,
        previousDate,
        laterField,
        laterDate,
      ].join("|");
      if (isAnomalySuppressed(signature, ruleKey, suppressions)) return;
      const emittedKey = [
        file.id,
        getCanonicalAnomalyContext(context),
        normalizeAnomalyKey(rule),
        previousField,
        previousDate,
        laterField,
        laterDate,
      ].join("|");
      if (emittedAnomalyKeys.has(emittedKey)) return;
      emittedAnomalyKeys.add(emittedKey);
      rows.push({
        signature,
        fileId: file.id,
        fileRef: getAnomalyFileRef(file),
        division: file.division ?? "",
        indentor: file.indentor ?? "",
        description: file.demandDescription ?? "",
        block,
        rule,
        ruleKey,
        previousField,
        previousDate: previousDate!,
        laterField,
        laterDate: laterDate!,
        accepted: "No",
      });
    };
    const addIssue = (
      block: string,
      rule: string,
      expectedField: string,
      expectedValue: string,
      foundField: string,
      foundValue: string,
      context = "file",
    ) => {
      const ruleKey = normalizeAnomalyKey(rule);
      const signature = [
        file.id,
        context,
        ruleKey,
        expectedField,
        expectedValue,
        foundField,
        foundValue,
      ].join("|");
      if (isAnomalySuppressed(signature, ruleKey, suppressions)) return;
      const emittedKey = [
        file.id,
        getCanonicalAnomalyContext(context),
        normalizeAnomalyKey(rule),
        expectedField,
        expectedValue,
        foundField,
        foundValue,
      ].join("|");
      if (emittedAnomalyKeys.has(emittedKey)) return;
      emittedAnomalyKeys.add(emittedKey);
      rows.push({
        signature,
        fileId: file.id,
        fileRef: getAnomalyFileRef(file),
        division: file.division ?? "",
        indentor: file.indentor ?? "",
        description: file.demandDescription ?? "",
        block,
        rule,
        ruleKey,
        previousField: expectedField,
        previousDate: expectedValue,
        laterField: foundField,
        laterDate: foundValue,
        accepted: "No",
      });
    };

    const supplyOrders = fileSupplyOrders(file);
    const activeSupplyOrders = supplyOrders.filter(
      (order) => !isYes(order.soCancelled) && !isYes(order.shortclosure),
    );
    const hasSupplyOrderWorkflow = supplyOrders.some((order) => hasFilledString(order.soDate));
    const hasCncWorkflow = hasFilledString(file.cncDate) || hasFilledString(file.cncApprovalDate);
    const fileClosed = hasCompletedMilestone(file.completedMilestones, fileClosedMilestone);
    const fileReceivedDate = file.receivedDate;

    if (!hasFilledString(file.division)) {
      addIssue(
        "Data Completeness",
        "File has no division",
        "Division",
        "Filled",
        "Division",
        "Blank",
      );
    }
    if (!hasFilledString(file.indentor)) {
      addIssue(
        "Data Completeness",
        "File has no indentor",
        "Indentor",
        "Filled",
        "Indentor",
        "Blank",
      );
    }
    if (!hasFilledString(file.fileNo) && !hasFilledString(file.uniqueCode)) {
      addIssue(
        "Data Completeness",
        "File has no file number or unique code",
        "File number / unique code",
        "Filled",
        "File number / unique code",
        "Blank",
      );
    }
    if (!hasFilledString(file.demandDescription)) {
      addIssue(
        "Data Completeness",
        "File has no demand description",
        "Demand description",
        "Filled",
        "Demand description",
        "Blank",
      );
    }
    [file.uniqueCode, file.fileNo]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .forEach((value) => {
        if (duplicateFileRefs.has(value.trim())) {
          addIssue(
            "Data Completeness",
            "Duplicate file number or unique code across active files",
            "Unique file reference",
            "Unique",
            "Duplicate value",
            value,
          );
        }
      });

    if (isBiddingApplicableForFile(file)) {
      if (
        isYes(file.refloat) &&
        (!hasFilledString(file.refloatBiddingDate) || !hasFilledString(file.refloatBidOpeningDate))
      ) {
        addIssue(
          "Refloat",
          "Refloat is Yes but refloat bidding or opening date is blank",
          "Refloat bidding/opening dates",
          "Filled",
          "Refloat dates",
          "Blank",
        );
      }
      if (
        isNo(file.refloat) &&
        (hasFilledString(file.refloatBiddingDate) || hasFilledString(file.refloatBidOpeningDate))
      ) {
        addIssue(
          "Refloat",
          "Refloat bidding or opening dates are filled while Refloat is No",
          "Refloat Yes or dates blank",
          "Refloat No with blank dates",
          "Refloat dates",
          "Filled",
        );
      }
      if (isYes(file.tenderLive) && !hasFilledString(file.bidDate)) {
        addIssue(
          "Bidding",
          "Tender Live is Yes but bid date is blank",
          "Bid date",
          "Filled",
          "Bid date",
          "Blank",
        );
      }
      if (hasFilledString(file.bidOpeningDate) && !hasFilledString(file.bidDate)) {
        addIssue(
          "Bidding",
          "Bid opening date exists but bid date is blank",
          "Bid date",
          "Filled",
          "Bid opening date",
          file.bidOpeningDate!,
        );
      }
      if (isYes(file.bidOpened) && !hasFilledString(file.bidOpeningDate)) {
        addIssue(
          "Bidding",
          "Bid Opened is Yes but bid opening date is blank",
          "Bid opening date",
          "Filled",
          "Bid Opened",
          "Yes",
        );
      }
      if (isYes(file.biddingStageOver) && !hasFilledString(file.bidOpeningDate)) {
        addIssue(
          "Bidding",
          "Bidding Stage Over is Yes but bid opening date is blank",
          "Bid opening date",
          "Filled",
          "Bidding Stage Over",
          "Yes",
        );
      }
      if (isNo(file.biddingStageOver) && (hasCncWorkflow || hasSupplyOrderWorkflow)) {
        addIssue(
          "Bidding",
          "Bidding Stage Over is No but CNC or S.O. workflow exists",
          "Bidding Stage Over",
          "Yes",
          "Later workflow",
          "CNC/S.O. exists",
        );
      }
    }
    if (
      isYes(file.highValue) &&
      !hasFilledString(file.highValueMeetingDate) &&
      hasLaterWorkflowAfterHighValue(file)
    ) {
      addIssue(
        "High Value",
        "High Value is Yes but meeting date is blank after later workflow exists",
        "High Value meeting date",
        "Filled",
        "Later workflow",
        "Exists",
      );
    }
    if (
      isYes(file.tcec) &&
      (!hasFilledString(file.preTcecDate) || !hasFilledString(file.preTcecMinutesDate)) &&
      hasLaterWorkflowAfterTcec(file)
    ) {
      addIssue(
        "TCEC",
        "TCEC is Yes but required TCEC dates are blank after later workflow exists",
        "Pre-TCEC dates",
        "Filled",
        "Later workflow",
        "Exists",
      );
    }
    if (
      isYes(file.ifa) &&
      (!hasFilledString(file.ifaSentDate) || !hasFilledString(file.ifaFinalDate)) &&
      hasSupplyOrderWorkflow
    ) {
      addIssue(
        "IFA",
        "IFA is Yes but IFA sent or final date is blank after S.O. exists",
        "IFA dates",
        "Filled",
        "S.O. workflow",
        "Exists",
      );
    }
    if (
      hasFilledString(file.cfaDate) &&
      hasFilledString(file.immsDate) &&
      file.cfaDate! < file.immsDate!
    ) {
      addIssue(
        "CFA",
        "CFA approval date is before demand control date",
        "Demand control date",
        file.immsDate!,
        "CFA approval date",
        file.cfaDate!,
      );
    }
    const effectiveBidOpeningDate = isYes(file.refloat)
      ? file.refloatBidOpeningDate
      : file.bidOpeningDate;
    const effectivePostTcecDate = isYes(file.refloat)
      ? file.refloatPostTcecDate
      : file.postTcecDate;
    if (
      hasFilledString(effectivePostTcecDate) &&
      hasFilledString(effectiveBidOpeningDate) &&
      effectivePostTcecDate! < effectiveBidOpeningDate!
    ) {
      addIssue(
        "TCEC",
        "Post-TCEC date exists before Bid Opening Date",
        "Bid opening date",
        effectiveBidOpeningDate!,
        "Post-TCEC date",
        effectivePostTcecDate!,
      );
    }
    if (
      hasFilledString(file.cncDate) &&
      hasFilledString(file.bidOpeningDate) &&
      file.cncDate! < file.bidOpeningDate!
    ) {
      addIssue(
        "CNC",
        "CNC date exists before Bid Opening Date",
        "Bid opening date",
        file.bidOpeningDate!,
        "CNC date",
        file.cncDate!,
      );
    }
    if (isYes(file.demandCancelled) && !hasFilledString(file.demandCancelledDate)) {
      addIssue(
        "Cancellation",
        "Demand Cancelled is Yes but cancellation date is blank",
        "Demand cancellation date",
        "Filled",
        "Demand Cancelled",
        "Yes",
      );
    }
    if (isNo(file.demandCancelled) && hasFilledString(file.demandCancelledDate)) {
      addIssue(
        "Cancellation",
        "Demand Cancelled is No but cancellation date is filled",
        "Demand cancellation date",
        "Blank",
        "Demand cancellation date",
        file.demandCancelledDate!,
      );
    }
    addPair(
      "Cancellation",
      "Demand cancellation date should not be before Demand received date",
      "Demand received date",
      fileReceivedDate,
      "Demand cancellation date",
      file.demandCancelledDate,
    );

    if (fileClosed) {
      if (!hasFilledString(file.fileClosureDate)) {
        addIssue(
          "Closure",
          "File Closed is Done but File Closure Date is blank",
          "File Closure Date",
          "Filled",
          "File Closed",
          "Done",
        );
      }
      if (
        effectiveSupplyOrderEntries([file]).some(
          ({ order }) =>
            !hasFilledString(order.paymentDate) &&
            !isYes(order.soCancelled) &&
            !isYes(order.shortclosure),
        )
      ) {
        addIssue(
          "Closure",
          "File closed but payment pending exists",
          "Payment",
          "Completed before file closure",
          "Payment",
          "Pending",
        );
      }
      if (supplyOrders.some(hasBgReturnPendingForAnyCategory)) {
        addIssue(
          "Closure",
          "File closed but BG return pending exists",
          "BG return",
          "Completed before file closure",
          "BG return",
          "Pending",
        );
      }
      if (hasFilledString(file.currentMilestone)) {
        addIssue(
          "Closure",
          "File closed while current milestone still exists",
          "Current milestone",
          "Blank",
          "Current milestone",
          file.currentMilestone!,
        );
      }
    } else if (hasFilledString(file.fileClosureDate)) {
      addIssue(
        "Closure",
        "File Closure Date is filled but File Closed is not marked Done",
        "File Closed",
        "Done",
        "File Closure Date",
        file.fileClosureDate!,
      );
    }
    if (isYes(file.demandCancelled) && hasFilledString(file.currentMilestone)) {
      addIssue(
        "Cancellation",
        "Cancelled demand still has active milestone",
        "Current milestone",
        "Blank",
        "Current milestone",
        file.currentMilestone!,
      );
    }

    addPreControlReceivedDateAnomalies(file, fileReceivedDate, addPair);

    addPair(
      "Scrutiny",
      "Demand received date should not be after scrutiny date",
      "Demand received date",
      file.receivedDate,
      "Scrutiny date",
      file.scrutinyDate,
    );
    addPair(
      "Scrutiny",
      "Scrutiny date should not be after scrutiny completion",
      "Scrutiny date",
      file.scrutinyDate,
      "Scrutiny completion",
      file.scrutinyCompletionDate,
    );
    addPair(
      "Scrutiny",
      "Scrutiny date should not be after scrutiny response",
      "Scrutiny date",
      file.scrutinyDate,
      "Scrutiny response date",
      file.scrutinyResponseDate,
    );
    addPair(
      "Scrutiny",
      "Scrutiny response should not be after scrutiny completion",
      "Scrutiny response date",
      file.scrutinyResponseDate,
      "Scrutiny completion",
      file.scrutinyCompletionDate,
    );
    addPair(
      "Control",
      "Scrutiny completion should not be after demand control",
      "Scrutiny completion",
      file.scrutinyCompletionDate,
      "Demand control date",
      file.immsDate,
    );
    addPair(
      "CFA",
      "Demand control date should not be after CFA sent date",
      "Demand control date",
      file.immsDate,
      "CFA sent date",
      file.cfaSentDate,
    );
    addPair(
      "Bidding",
      "CFA approval date should not be after bid date",
      "CFA approval date",
      file.cfaDate,
      "Bid date",
      file.bidDate,
    );
    addPair(
      "High Value",
      "High value meeting should not be after minutes",
      "High value meeting",
      file.highValueMeetingDate,
      "High value minutes",
      file.highValueMinutesDate,
    );
    addPair(
      "TCEC",
      "Pre-TCEC date should not be after Pre-TCEC minutes",
      "Pre-TCEC date",
      file.preTcecDate,
      "Pre-TCEC minutes",
      file.preTcecMinutesDate,
    );
    addPair(
      "TCEC",
      "Post-TCEC date should not be after Post-TCEC minutes",
      "Post-TCEC date",
      file.postTcecDate,
      "Post-TCEC minutes",
      file.postTcecMinutesDate,
    );
    addPair(
      "TCEC",
      "Refloat Post-TCEC date should not be after Refloat Post-TCEC minutes",
      "Refloat Post-TCEC date",
      file.refloatPostTcecDate,
      "Refloat Post-TCEC minutes",
      file.refloatPostTcecMinutesDate,
    );
    addPair(
      "IFA",
      "IFA sent date should not be after IFA final date",
      "IFA sent date",
      file.ifaSentDate,
      "IFA final date",
      file.ifaFinalDate,
    );
    addPair(
      "CFA",
      "CFA sent date should not be after CFA approval date",
      "CFA sent date",
      file.cfaSentDate,
      "CFA approval date",
      file.cfaDate,
    );
    addPair(
      "Bidding",
      "Bid date should not be after bid opening date",
      "Bid date",
      file.bidDate,
      "Bid opening date",
      file.bidOpeningDate,
    );
    if (isBiddingApplicableForFile(file)) {
      addPair(
        "Bidding",
        "Refloat bid date should not be after refloat bid opening",
        "Refloat bid date",
        file.refloatBiddingDate,
        "Refloat bid opening",
        file.refloatBidOpeningDate,
      );
      if (isYes(file.preBidMeeting) && !hasFilledString(file.preBidMeetingDate)) {
        addIssue(
          "Pre-Bid Meeting",
          "Pre-Bid Meeting is Yes but date is missing",
          "Expected",
          "Pre-Bid Meeting date filled",
          "Found",
          "Pre-Bid Meeting Yes with blank date",
        );
      }
      if (isNo(file.preBidMeeting) && hasFilledString(file.preBidMeetingDate)) {
        addIssue(
          "Pre-Bid Meeting",
          "Pre-Bid Meeting date is filled while Pre-Bid Meeting is No",
          "Expected",
          "Pre-Bid Meeting Yes or date blank",
          "Found",
          "Pre-Bid Meeting No with date filled",
        );
      }
      addPair(
        "Pre-Bid Meeting",
        "Demand received date should not be after Pre-Bid Meeting date",
        "Demand received date",
        file.receivedDate,
        "Pre-Bid Meeting date",
        file.preBidMeetingDate,
      );
      addPair(
        "Pre-Bid Meeting",
        "Pre-Bid Meeting date should not be before bid date",
        "Bid date",
        file.bidDate,
        "Pre-Bid Meeting date",
        file.preBidMeetingDate,
      );
      addPair(
        "Pre-Bid Meeting",
        "Pre-Bid Meeting date should not be after bid opening date",
        "Pre-Bid Meeting date",
        file.preBidMeetingDate,
        "Bid opening date",
        file.bidOpeningDate,
      );
    }
    if (isBiddingApplicableForFile(file)) {
      if (
        !isYes(file.refloat) &&
        (isYes(file.refloatPreBidMeeting) || hasFilledString(file.refloatPreBidMeetingDate))
      ) {
        addIssue(
          "Refloat Pre-Bid Meeting",
          "Refloat Pre-Bid fields are filled while Refloat is No",
          "Expected",
          "Refloat Yes or refloat pre-bid fields blank",
          "Found",
          "Refloat Pre-Bid data without Refloat",
        );
      }
      if (
        isYes(file.refloat) &&
        isYes(file.refloatPreBidMeeting) &&
        !hasFilledString(file.refloatPreBidMeetingDate)
      ) {
        addIssue(
          "Refloat Pre-Bid Meeting",
          "Refloat Pre-Bid Meeting is Yes but date is missing",
          "Expected",
          "Refloat Pre-Bid Meeting date filled",
          "Found",
          "Refloat Pre-Bid Meeting Yes with blank date",
        );
      }
      if (
        isYes(file.refloat) &&
        isNo(file.refloatPreBidMeeting) &&
        hasFilledString(file.refloatPreBidMeetingDate)
      ) {
        addIssue(
          "Refloat Pre-Bid Meeting",
          "Refloat Pre-Bid Meeting date is filled while Refloat Pre-Bid Meeting is No",
          "Expected",
          "Refloat Pre-Bid Meeting Yes or date blank",
          "Found",
          "Refloat Pre-Bid Meeting No with date filled",
        );
      }
      addPair(
        "Refloat Pre-Bid Meeting",
        "Refloat Pre-Bid Meeting date should not be before refloat bid date",
        "Refloat bid date",
        file.refloatBiddingDate,
        "Refloat Pre-Bid Meeting date",
        file.refloatPreBidMeetingDate,
      );
      addPair(
        "Refloat Pre-Bid Meeting",
        "Refloat Pre-Bid Meeting date should not be after refloat bid opening date",
        "Refloat Pre-Bid Meeting date",
        file.refloatPreBidMeetingDate,
        "Refloat bid opening date",
        file.refloatBidOpeningDate,
      );
    }
    addPair(
      "CNC",
      "CNC date should not be after CNC approval date",
      "CNC date",
      file.cncDate,
      "CNC approval date",
      file.cncApprovalDate,
    );
    if (
      isNo(file.highValue) &&
      (hasFilledString(file.highValueMeetingDate) || hasFilledString(file.highValueMinutesDate))
    ) {
      addIssue(
        "High Value",
        "High Value dates are filled while High Value is No",
        "Expected",
        "High Value Yes or dates blank",
        "Found",
        "High Value No with High Value dates",
      );
    }
    if (
      isNo(file.tcec) &&
      (hasFilledString(file.preTcecDate) ||
        hasFilledString(file.preTcecMinutesDate) ||
        hasFilledString(file.postTcecDate) ||
        hasFilledString(file.postTcecMinutesDate) ||
        hasFilledString(file.refloatPostTcecDate) ||
        hasFilledString(file.refloatPostTcecMinutesDate))
    ) {
      addIssue(
        "TCEC",
        "TCEC dates are filled while TCEC is No",
        "Expected",
        "TCEC Yes or dates blank",
        "Found",
        "TCEC No with TCEC dates",
      );
    }
    if (
      isNo(file.ifa) &&
      (hasFilledString(file.ifaSentDate) || hasFilledString(file.ifaFinalDate))
    ) {
      addIssue(
        "IFA",
        "IFA dates are filled while IFA is No",
        "Expected",
        "IFA Yes or dates blank",
        "Found",
        "IFA No with IFA dates",
      );
    }

    const expectedSoCount = readPositiveInteger(file.noOfSo);
    if (expectedSoCount !== undefined && expectedSoCount !== supplyOrders.length) {
      addIssue(
        "Supply Order",
        "Multiple S.O. count does not match actual S.O. rows",
        "No. of S.O.",
        String(expectedSoCount),
        "Actual S.O. rows",
        String(supplyOrders.length),
      );
    }

    supplyOrders.forEach((rawOrder, rawIndex) => {
      const rawContext = `order:${rawOrder.soNo || rawOrder.gemSoNo || `S.O. ${rawIndex + 1}`}:${rawIndex}`;
      const rawLabel = rawOrder.soNo || rawOrder.gemSoNo || `S.O. ${rawIndex + 1}`;
      const hasSoDate = hasFilledString(rawOrder.soDate);
      const rawStageRows = rawOrder.stageDeliveries ?? [];
      const expectedStageCount = readPositiveInteger(rawOrder.stageDeliveryCount);
      const bgFieldsFilled = hasAnyBgField(rawOrder);
      const orderBgMarkedYes = isYes(rawOrder.psbApplicable) || bgFieldsFilled;

      if (hasSoDate && !hasFilledString(rawOrder.financialSanctionDate)) {
        addIssue(
          "Supply Order",
          "S.O. date exists but Financial Sanction date is blank",
          "Financial Sanction date",
          "Filled",
          "S.O. date",
          rawOrder.soDate!,
          rawContext,
        );
      }
      if (hasSoDate && !hasFilledString(rawOrder.firm)) {
        addIssue(
          "Supply Order",
          "S.O. placed but firm name is blank",
          "Firm name",
          "Filled",
          "S.O.",
          rawLabel,
          rawContext,
        );
      }
      if (hasSoDate && getExpectedOrderValue(file, rawOrder) <= 0) {
        addIssue(
          "Supply Order",
          "S.O. value is blank or zero while S.O. date exists",
          "S.O. value",
          "Greater than zero",
          "S.O. date",
          rawOrder.soDate!,
          rawContext,
        );
      }
      if (isYes(rawOrder.soCancelled) && !hasFilledString(rawOrder.soCancelledDate)) {
        addIssue(
          "Cancellation",
          "S.O. cancelled is Yes but S.O. cancelled date is blank",
          "S.O. cancelled date",
          "Filled",
          "S.O. cancelled",
          "Yes",
          rawContext,
        );
      }
      if (isNo(rawOrder.soCancelled) && hasFilledString(rawOrder.soCancelledDate)) {
        addIssue(
          "Cancellation",
          "S.O. cancelled is No but S.O. cancelled date is filled",
          "S.O. cancelled date",
          "Blank",
          "S.O. cancelled date",
          rawOrder.soCancelledDate!,
          rawContext,
        );
      }
      addPair(
        "Cancellation",
        "S.O. cancellation date should not be before S.O. date",
        "S.O. date",
        rawOrder.soDate,
        "S.O. cancelled date",
        rawOrder.soCancelledDate,
        rawContext,
      );
      if (
        isYes(rawOrder.soCancelled) &&
        hasFilledString(rawOrder.soCancelledDate) &&
        hasWorkflowAfterDate(rawOrder, rawOrder.soCancelledDate)
      ) {
        addIssue(
          "Cancellation",
          "S.O. cancelled but delivery/payment/job completion continues after cancellation date",
          "Workflow after cancellation",
          "Blank",
          "Later workflow",
          "Exists",
          rawContext,
        );
      }
      if (isYes(rawOrder.shortclosure) && !hasFilledString(rawOrder.shortclosureDate)) {
        addIssue(
          "Cancellation",
          "Shortclosure is Yes but Shortclosure date is blank",
          "Shortclosure date",
          "Filled",
          "Shortclosure",
          "Yes",
          rawContext,
        );
      }
      if (isNo(rawOrder.shortclosure) && hasFilledString(rawOrder.shortclosureDate)) {
        addIssue(
          "Cancellation",
          "Shortclosure is No but Shortclosure date is filled",
          "Shortclosure date",
          "Blank",
          "Shortclosure date",
          rawOrder.shortclosureDate!,
          rawContext,
        );
      }
      addPair(
        "Cancellation",
        "Shortclosure date should not be before S.O. date",
        "S.O. date",
        rawOrder.soDate,
        "Shortclosure date",
        rawOrder.shortclosureDate,
        rawContext,
      );
      if (
        isYes(rawOrder.shortclosure) &&
        hasFilledString(rawOrder.shortclosureDate) &&
        hasWorkflowAfterDate(rawOrder, rawOrder.shortclosureDate)
      ) {
        addIssue(
          "Cancellation",
          "S.O. shortclosed but delivery/payment/job completion continues after shortclosure date",
          "Workflow after shortclosure",
          "Blank",
          "Later workflow",
          "Exists",
          rawContext,
        );
      }
      if (isYes(rawOrder.dpExtension) && !hasFilledString(rawOrder.revisedDp)) {
        addIssue(
          "Delivery Period",
          "D.P. Extension is Yes but Revised D.P. is blank",
          "Revised D.P.",
          "Filled",
          "D.P. Extension",
          "Yes",
          rawContext,
        );
      }
      if (hasSoDate && !isYes(rawOrder.soCancelled) && !isYes(rawOrder.shortclosure)) {
        if (isYes(rawOrder.stageDelivery)) {
          rawStageRows.forEach((stage, stageIndex) => {
            const stageContext = `${rawContext}:stage:${stageIndex + 1}`;
            const stageLabel = `Stage ${stageIndex + 1}`;
            if (!isIsoDate(stage.deliveryPeriodStartDate)) {
              addIssue(
                "Delivery Period",
                "Supply Order placed but stage D.P. start date is blank",
                `${stageLabel} D.P. start date`,
                "Filled",
                "S.O. date",
                rawOrder.soDate!,
                stageContext,
              );
            }
            if (!isIsoDate(stage.dpDate)) {
              addIssue(
                "Delivery Period",
                "Supply Order placed but stage D.P. date is blank",
                `${stageLabel} D.P. date`,
                "Filled",
                "S.O. date",
                rawOrder.soDate!,
                stageContext,
              );
            }
            if (isYes(stage.dpExtension) && !hasFilledString(stage.dpExtensionCount)) {
              addIssue(
                "Delivery Period",
                "Stage D.P. Extension is Yes but extension count is blank",
                `${stageLabel} D.P. Extension count`,
                "Filled",
                "D.P. Extension",
                "Yes",
                stageContext,
              );
            }
            if (isYes(stage.dpExtension) && !isIsoDate(stage.revisedDp)) {
              addIssue(
                "Delivery Period",
                "Stage D.P. Extension is Yes but Revised D.P. is blank",
                `${stageLabel} Revised D.P.`,
                "Filled",
                "D.P. Extension",
                "Yes",
                stageContext,
              );
            }
          });
        } else if (!isIsoDate(rawOrder.dpDate)) {
          addIssue(
            "Delivery Period",
            "Supply Order placed but D.P. date is blank",
            "D.P. date",
            "Filled",
            "S.O. date",
            rawOrder.soDate!,
            rawContext,
          );
        }
      }
      if (isNo(rawOrder.dpExtension) && hasFilledString(rawOrder.revisedDp)) {
        addIssue(
          "Delivery Period",
          "Revised D.P. is filled while D.P. Extension is No",
          "Revised D.P.",
          "Blank",
          "Revised D.P.",
          rawOrder.revisedDp!,
          rawContext,
        );
      }
      if (isNo(rawOrder.dpExtension) && hasFilledString(rawOrder.dpExtensionCount)) {
        addIssue(
          "Delivery Period",
          "D.P. Extension count is filled while D.P. Extension is No",
          "D.P. Extension count",
          "Blank",
          "D.P. Extension count",
          rawOrder.dpExtensionCount!,
          rawContext,
        );
      }
      if (isYes(rawOrder.dpExtension) && !hasFilledString(rawOrder.dpExtensionCount)) {
        addIssue(
          "Delivery Period",
          "D.P. Extension is Yes but extension count is blank",
          "D.P. Extension count",
          "Filled",
          "D.P. Extension",
          "Yes",
          rawContext,
        );
      }
      if (
        hasFilledString(rawOrder.dpDate) &&
        hasFilledString(rawOrder.revisedDp) &&
        rawOrder.revisedDp! < rawOrder.dpDate!
      ) {
        addIssue(
          "Delivery Period",
          "Revised D.P. is earlier than original D.P.",
          "Original D.P.",
          rawOrder.dpDate!,
          "Revised D.P.",
          rawOrder.revisedDp!,
          rawContext,
        );
      }
      addPair(
        "Delivery Period",
        "Delivery period start date should not be after D.P. date",
        "Delivery period start date",
        rawOrder.deliveryPeriodStartDate,
        "D.P. date",
        rawOrder.dpDate,
        rawContext,
      );

      if (
        isYes(rawOrder.stageDelivery) &&
        expectedStageCount !== undefined &&
        expectedStageCount !== rawStageRows.length
      ) {
        addIssue(
          "Stage Delivery",
          "Stage delivery count does not match actual stage rows",
          "Stage delivery count",
          String(expectedStageCount),
          "Actual stage rows",
          String(rawStageRows.length),
          rawContext,
        );
      }
      if (isYes(rawOrder.stageDelivery) && rawStageRows.length === 0) {
        addIssue(
          "Stage Delivery",
          "Stage Delivery is Yes but stage rows are missing",
          "Stage rows",
          "Present",
          "Stage rows",
          "Missing",
          rawContext,
        );
      }
      if (isNo(rawOrder.stageDelivery) && rawStageRows.length > 0) {
        addIssue(
          "Stage Delivery",
          "Stage Delivery is No but stage delivery rows exist",
          "Stage rows",
          "Blank",
          "Actual stage rows",
          String(rawStageRows.length),
          rawContext,
        );
      }
      rawStageRows.forEach((stage, stageIndex) => {
        const stageContext = `${rawContext}:stage:${stageIndex + 1}`;
        addPair(
          "Delivery Period",
          "Stage D.P. date should not be before stage delivery period start date",
          "Stage delivery period start date",
          stage.deliveryPeriodStartDate,
          "Stage D.P. date",
          stage.dpDate,
          stageContext,
        );
        if (isStageDone(stage) && isStageCurrent(stage)) {
          addIssue(
            "Stage Delivery",
            "Stage marked Done and Current at the same time",
            "Current or Done",
            "Only one active state",
            "Stage status",
            "Current and Done",
            stageContext,
          );
        }
        const previousStage = rawStageRows[stageIndex - 1];
        if (
          stageIndex > 0 &&
          hasStageCompletion(stage) &&
          previousStage &&
          !hasStageCompletion(previousStage)
        ) {
          addIssue(
            "Stage Delivery",
            "Later stage completed while earlier stage is incomplete",
            "Earlier stage completion",
            "Done",
            "Later stage",
            `Stage ${stageIndex + 1} completed`,
            stageContext,
          );
        }
        if (
          stageIndex > 0 &&
          hasStagePaymentOrBillWorkflow(stage) &&
          previousStage &&
          !hasStageCompletion(previousStage)
        ) {
          addIssue(
            "Stage Payment",
            "Later stage has payment or bill dates while earlier stage delivery/job completion is incomplete",
            "Earlier stage completion",
            "Done",
            "Later stage payment workflow",
            "Started",
            stageContext,
          );
        }
        if (hasFilledString(stage.paymentDate) && !hasStageCompletion(stage)) {
          addIssue(
            "Stage Payment",
            "Stage payment date exists before that stage material receipt or job completion",
            "Stage delivery/job completion",
            "Done",
            "Stage payment date",
            stage.paymentDate!,
            stageContext,
          );
        }
        if (isYes(rawOrder.stagePayment) && getOrderValue(stage) <= 0) {
          addIssue(
            "Stage Payment",
            "Stage Payment is Yes but stage amount is blank",
            "Stage amount",
            "Greater than zero",
            "Stage amount",
            "Blank/zero",
            stageContext,
          );
        }
      });
      if (isNo(rawOrder.stagePayment) && rawStageRows.some(hasStagePaymentOrAmountFields)) {
        addIssue(
          "Stage Payment",
          "Stage Payment is No but stage payment dates or amounts exist",
          "Stage payment fields",
          "Blank",
          "Stage payment data",
          "Filled",
          rawContext,
        );
      }
      if (isNo(rawOrder.advancePayment) && hasAdvancePaymentData(rawOrder)) {
        addIssue(
          "Advance Payment",
          "Advance Payment is No but advance payment details exist",
          "Advance payment details",
          "Blank",
          "Advance payment details",
          "Filled",
          rawContext,
        );
      }
      if (
        isYes(rawOrder.advancePayment) &&
        hasAdvancePaymentDone(rawOrder) &&
        !isAdvancePaymentWorkflowComplete(rawOrder)
      ) {
        addIssue(
          "Advance Payment",
          "Advance Payment is Yes but advance payment workflow is incomplete after payment marked done",
          "Advance payment workflow",
          "Complete",
          "Advance payment",
          "Marked done/incomplete",
          rawContext,
        );
      }
      if (isNo(file.bg) && bgFieldsFilled) {
        addIssue(
          "Bank Guarantee",
          "BG is No but PSB/PWB/PSB+PWB fields are filled",
          "BG fields",
          "Blank",
          "BG fields",
          "Filled",
          rawContext,
        );
      }
      if (
        isYes(file.bg) &&
        orderBgMarkedYes &&
        (!hasFilledString(rawOrder.bgCoverageType) || rawOrder.bgCoverageType === "None")
      ) {
        addIssue(
          "Bank Guarantee",
          "BG is Yes but coverage type is blank or None",
          "BG coverage type",
          "Selected",
          "BG coverage type",
          rawOrder.bgCoverageType || "Blank",
          rawContext,
        );
      }
      if (
        isNo(file.bg) &&
        hasFilledString(rawOrder.bgCoverageType) &&
        rawOrder.bgCoverageType !== "None"
      ) {
        addIssue(
          "Bank Guarantee",
          "BG coverage type selected but BG is No",
          "BG",
          "Yes or coverage None",
          "BG coverage type",
          rawOrder.bgCoverageType!,
          rawContext,
        );
      }
      if (
        hasFilledString(rawOrder.warrantyPeriodDate) &&
        !hasWarrantyBgApplicable(file, rawOrder)
      ) {
        addIssue(
          "Warranty / BG mismatch",
          "Warranty Period Date exists but no PWB or PSB+PWB is applicable",
          "PWB/PSB+PWB applicability",
          "Applicable",
          "Warranty period",
          rawOrder.warrantyPeriodDate!,
          rawContext,
        );
      }
      const completionDate = getDeliveryOrJobCompletionDate(file, rawOrder);
      if (
        hasFilledString(rawOrder.warrantyPeriodDate) &&
        hasFilledString(completionDate) &&
        rawOrder.warrantyPeriodDate! < completionDate!
      ) {
        addIssue(
          "Warranty / BG mismatch",
          "Warranty Period Date is before material receipt or job completion",
          "Delivery/job completion date",
          completionDate!,
          "Warranty period",
          rawOrder.warrantyPeriodDate!,
          rawContext,
        );
      }
      addWarrantyBufferAnomalies(file, rawOrder, rawContext, addIssue);

      [rawOrder.psbBgNo, rawOrder.pwbBgNo, rawOrder.combinedBgNo]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .forEach((value) => {
          if (duplicateBgNumbers.has(value)) {
            addIssue(
              "Bank Guarantee",
              "Duplicate BG number across active files",
              "BG number",
              "Unique",
              "Duplicate BG number",
              value,
              rawContext,
            );
          }
        });
    });

    effectiveSupplyOrderEntries([file]).forEach(({ order }, index) => {
      const orderLabel =
        order.soNo || order.gemSoNo || order.stageDeliveryLabel || `S.O. ${index + 1}`;
      const context = `order:${orderLabel}:${index}`;
      const jobCompletionDone = isJobCompletionDone(order);
      const paymentWorkflowStarted =
        hasFilledString(order.billPreparationDate) ||
        hasFilledString(order.billSentForPaymentDate) ||
        hasFilledString(order.paymentDate);
      const paymentWorkflowStartedLabel = [
        hasFilledString(order.billPreparationDate) ? "Bill preparation date" : "",
        hasFilledString(order.billSentForPaymentDate) ? "Bill sent for payment date" : "",
        hasFilledString(order.paymentDate) ? "Payment date" : "",
      ]
        .filter(Boolean)
        .join(", ");

      if (isJobCompletionWorkflow(file) && paymentWorkflowStarted && !jobCompletionDone) {
        addIssue(
          "Job Completion",
          "Payment workflow should not start before Job Completion Done",
          "Expected",
          "Job Completion Done checked",
          "Found",
          paymentWorkflowStartedLabel || "Payment workflow started",
          context,
        );
      }
      if (
        isJobCompletionWorkflow(file) &&
        jobCompletionDone &&
        !hasFilledString(order.jobCompletionDate)
      ) {
        addIssue(
          "Job Completion",
          "Job Completion Done is checked but Job Completion Date is blank",
          "Job Completion Date",
          "Filled for timeline/reporting",
          "Job Completion Done",
          "Checked",
          context,
        );
      }
      if (
        isPhysicalDeliveryWorkflow(file) &&
        paymentWorkflowStarted &&
        !hasFilledString(order.materialReceiptDate)
      ) {
        addIssue(
          "Delivery",
          "Payment workflow should not start before material receipt",
          "Expected",
          "Material receipt date filled",
          "Found",
          paymentWorkflowStartedLabel || "Payment workflow started",
          context,
        );
      }
      if (
        isPhysicalDeliveryWorkflow(file) &&
        isYes(file.ir) &&
        hasFilledString(order.paymentDate) &&
        !hasFilledString(order.irReceiptDate)
      ) {
        addIssue(
          "IR",
          "Payment should not be completed before IR receipt",
          "Expected",
          "IR receipt date filled",
          "Found",
          "Payment date filled",
          context,
        );
      }
      if (
        hasFilledString(order.billSentForPaymentDate) &&
        !hasFilledString(order.billPreparationDate)
      ) {
        addIssue(
          "Bill",
          "Bill sent for payment should not exist without bill preparation",
          "Expected",
          "Bill preparation date filled",
          "Found",
          "Bill sent for payment date filled",
          context,
        );
      }
      if (hasFilledString(order.paymentDate) && !hasFilledString(order.billSentForPaymentDate)) {
        addIssue(
          "Payment",
          "Payment date should not exist without bill sent for payment",
          "Expected",
          "Bill sent for payment date filled",
          "Found",
          "Payment date filled",
          context,
        );
      }
      addPair(
        "Supply Order",
        "Demand received date should not be after Financial Sanction date",
        "Demand received date",
        file.receivedDate,
        "Financial Sanction date",
        order.financialSanctionDate,
        context,
      );
      addPair(
        "Supply Order",
        "Demand received date should not be after S.O. date",
        "Demand received date",
        file.receivedDate,
        "S.O. date",
        order.soDate,
        context,
      );
      addPair(
        "Supply Order",
        "Financial Sanction date should not be after S.O. date",
        "Financial Sanction date",
        order.financialSanctionDate,
        "S.O. date",
        order.soDate,
        context,
      );
      addPair(
        "Supply Order",
        "Bid opening date should not be after Financial Sanction date",
        "Bid opening date",
        file.bidOpeningDate,
        "Financial Sanction date",
        order.financialSanctionDate,
        context,
      );
      addPair(
        "Supply Order",
        "Bid opening date should not be after S.O. date",
        "Bid opening date",
        file.bidOpeningDate,
        "S.O. date",
        order.soDate,
        context,
      );
      addPair(
        "Delivery Period",
        "S.O. date should not be after D.P. date",
        "S.O. date",
        order.soDate,
        "D.P. date",
        order.dpDate,
        context,
      );
      addPair(
        "Delivery Period",
        "S.O. date should not be after revised D.P.",
        "S.O. date",
        order.soDate,
        "Revised D.P.",
        order.revisedDp,
        context,
      );
      addPair(
        "Delivery",
        "S.O. date should not be after material receipt",
        "S.O. date",
        order.soDate,
        "Material receipt date",
        order.materialReceiptDate,
        context,
      );
      if (isJobCompletionWorkflow(file) && hasFilledString(order.materialReceiptDate)) {
        addIssue(
          "Job Completion",
          "Material receipt date is filled for a Job Completion workflow",
          "Expected",
          "Job Completion Done checkbox, no material receipt date",
          "Found",
          "Material receipt date filled",
          context,
        );
      }
      if (
        isJobCompletionWorkflow(file) &&
        (hasFilledString(order.irPreparationDate) || hasFilledString(order.irReceiptDate))
      ) {
        addIssue(
          "Job Completion",
          "IR dates are filled for a Job Completion workflow",
          "Expected",
          "IR dates blank",
          "Found",
          "IR preparation/receipt date filled",
          context,
        );
      }
      if (isPhysicalDeliveryWorkflow(file) && hasFilledString(order.jobCompletionDate)) {
        addIssue(
          "Delivery",
          "Job Completion Date exists for physical delivery workflow",
          "Job Completion Date",
          "Blank",
          "Job Completion Date",
          order.jobCompletionDate!,
          context,
        );
      }
      if (isPhysicalDeliveryWorkflow(file) && isJobCompletionDone(order)) {
        addIssue(
          "Delivery",
          "Job Completion Done checked for physical delivery workflow",
          "Job Completion Done",
          "Unchecked",
          "Job Completion Done",
          "Checked",
          context,
        );
      }
      if (
        isNo(file.ir) &&
        (hasFilledString(order.irPreparationDate) || hasFilledString(order.irReceiptDate))
      ) {
        addIssue(
          "IR",
          "IR is No but IR preparation or receipt dates exist",
          "IR dates",
          "Blank",
          "IR dates",
          "Filled",
          context,
        );
      }
      if (
        isPhysicalDeliveryWorkflow(file) &&
        isYes(file.ir) &&
        hasFilledString(order.irPreparationDate) &&
        !hasFilledString(order.materialReceiptDate)
      ) {
        addIssue(
          "IR",
          "IR preparation should not exist without material receipt",
          "Expected",
          "Material receipt date filled",
          "Found",
          "IR preparation date filled",
          context,
        );
      }
      if (hasFilledString(order.irReceiptDate) && !hasFilledString(order.irPreparationDate)) {
        addIssue(
          "IR",
          "IR receipt date exists without IR preparation",
          "Expected",
          "IR preparation date filled",
          "Found",
          "IR receipt date filled",
          context,
        );
      }
      addPair(
        "IR",
        "Material receipt should not be after IR preparation",
        "Material receipt date",
        order.materialReceiptDate,
        "IR preparation date",
        order.irPreparationDate,
        context,
      );
      addPair(
        "IR",
        "IR preparation should not be after IR receipt",
        "IR preparation date",
        order.irPreparationDate,
        "IR receipt date",
        order.irReceiptDate,
        context,
      );
      addPair(
        "Bill",
        "Material receipt should not be after bill preparation",
        "Material receipt date",
        order.materialReceiptDate,
        "Bill preparation date",
        order.billPreparationDate,
        context,
      );
      addPair(
        "Bill",
        "Bill preparation should not be after bill sent for payment",
        "Bill preparation date",
        order.billPreparationDate,
        "Bill sent for payment date",
        order.billSentForPaymentDate,
        context,
      );
      addPair(
        "Payment",
        "Bill sent for payment should not be after payment",
        "Bill sent for payment date",
        order.billSentForPaymentDate,
        "Payment date",
        order.paymentDate,
        context,
      );
      addPair(
        "Payment",
        "IR receipt should not be after payment",
        "IR receipt date",
        order.irReceiptDate,
        "Payment date",
        order.paymentDate,
        context,
      );
      addPair(
        "Payment",
        "Bill preparation should not be after payment",
        "Bill preparation date",
        order.billPreparationDate,
        "Payment date",
        order.paymentDate,
        context,
      );
      if (hasFilledString(order.paymentDate) && isPaymentBeforeDeliveryEquivalent(file, order)) {
        addIssue(
          "Payment",
          "Payment date is before material receipt or job completion",
          "Delivery/job completion",
          getDeliveryOrJobCompletionDate(file, order) || "Done",
          "Payment date",
          order.paymentDate!,
          context,
        );
      }
      if (hasFilledString(order.paymentDate) && !hasPaymentAmount(order)) {
        addIssue(
          "Payment",
          "Payment date is filled without actual payment amount",
          "Expected",
          "Actual payment amount filled",
          "Found",
          "Payment date filled",
          context,
        );
      }
      if (hasFilledString(order.paymentDate) && getActualPaymentValue(order) <= 0) {
        addIssue(
          "Payment",
          "Actual paid amount is zero while payment date exists",
          "Actual paid amount",
          "Greater than zero",
          "Payment date",
          order.paymentDate!,
          context,
        );
      }
      const paymentModeFilled = hasSelectablePaymentMode(order.paymentMode);
      if (hasFilledString(order.paymentDate) && !paymentModeFilled) {
        addIssue(
          "Payment",
          "Payment mode is blank while payment date exists",
          "Payment mode",
          "Filled",
          "Payment date",
          order.paymentDate!,
          context,
        );
      }
      if (
        !hasFilledString(order.paymentDate) &&
        paymentModeFilled &&
        hasPaymentDetailApartFromMode(order)
      ) {
        addIssue(
          "Payment",
          "Payment mode is filled while payment date is blank",
          "Payment mode",
          "Blank until payment date",
          "Payment mode",
          order.paymentMode!,
          context,
        );
      }
      if (
        getActualPaymentValue(order) > getExpectedOrderValue(file, order) &&
        getExpectedOrderValue(file, order) > 0
      ) {
        addIssue(
          "Payment",
          "Actual paid amount exceeds S.O. or stage amount",
          "Actual paid amount",
          "Within S.O./stage amount",
          "Actual paid amount",
          formatAmountForAnomaly(getActualPaymentValue(order)),
          context,
        );
      }
      if (hasWrongAmountSide(file, order)) {
        addIssue(
          "Payment",
          "Required value side mismatch for actual paid amount",
          "Amount side",
          getRequiredAmountSide(file),
          "Actual payment side",
          getActualAmountSide(order),
          context,
        );
      }
      if (!hasFilledString(order.paymentDate) && hasPaymentAmount(order)) {
        addIssue(
          "Payment",
          "Actual payment amount is filled without payment date",
          "Expected",
          "Payment date filled",
          "Found",
          "Actual payment amount filled",
          context,
        );
      }
      if (isMissingWarrantyPeriodAfterCompletion(file, order, "pwb")) {
        addIssue(
          "Warranty / BG mismatch",
          "Warranty period is missing for received PWB",
          "Expected",
          "Warranty period date filled after delivery/job completion",
          "Found",
          "PWB received but Warranty period blank",
          context,
        );
      }
      if (isMissingWarrantyPeriodAfterCompletion(file, order, "psbpwb")) {
        addIssue(
          "Warranty / BG mismatch",
          "Warranty period is missing for received PSB+PWB",
          "Expected",
          "Warranty period date filled after delivery/job completion",
          "Found",
          "PSB+PWB received but Warranty period blank",
          context,
        );
      }
      addBgAnomalies({
        kind: "PSB",
        context,
        fileReceivedDate: file.receivedDate,
        financialSanctionDate: order.financialSanctionDate,
        soDate: order.soDate,
        bgNo: order.psbBgNo,
        amount: order.psbBgAmount,
        receivedDate: order.psbBgReceivedDate,
        validityDate: order.psbBgValidityDate,
        returnDate: order.psbBgReturnDate,
        addPair,
        addIssue,
      });
      addBgAnomalies({
        kind: "PWB",
        context,
        fileReceivedDate: file.receivedDate,
        financialSanctionDate: order.financialSanctionDate,
        soDate: order.soDate,
        bgNo: order.pwbBgNo,
        amount: order.pwbBgAmount,
        receivedDate: order.pwbBgReceivedDate,
        validityDate: order.pwbBgValidityDate,
        returnDate: order.pwbBgReturnDate,
        addPair,
        addIssue,
      });
      addBgAnomalies({
        kind: "PSB+PWB",
        context,
        fileReceivedDate: file.receivedDate,
        financialSanctionDate: order.financialSanctionDate,
        soDate: order.soDate,
        bgNo: order.combinedBgNo,
        amount: order.combinedBgAmount,
        receivedDate: order.combinedBgReceivedDate,
        validityDate: order.combinedBgValidityDate,
        returnDate: order.combinedBgReturnDate,
        addPair,
        addIssue,
      });
      addPair(
        "PSB",
        "PSB received date should not be after PSB validity",
        "PSB received date",
        order.psbBgReceivedDate,
        "PSB validity date",
        order.psbBgValidityDate,
        context,
      );
      addPair(
        "PSB",
        "PSB received date should not be after PSB return",
        "PSB received date",
        order.psbBgReceivedDate,
        "PSB return date",
        order.psbBgReturnDate,
        context,
      );
      addPair(
        "PWB",
        "PWB received date should not be after PWB validity",
        "PWB received date",
        order.pwbBgReceivedDate,
        "PWB validity date",
        order.pwbBgValidityDate,
        context,
      );
      addPair(
        "PWB",
        "PWB received date should not be after PWB return",
        "PWB received date",
        order.pwbBgReceivedDate,
        "PWB return date",
        order.pwbBgReturnDate,
        context,
      );
      addPair(
        "PSB+PWB",
        "Combined BG received date should not be after combined BG validity",
        "Combined BG received date",
        order.combinedBgReceivedDate,
        "Combined BG validity date",
        order.combinedBgValidityDate,
        context,
      );
      addPair(
        "PSB+PWB",
        "Combined BG received date should not be after combined BG return",
        "Combined BG received date",
        order.combinedBgReceivedDate,
        "Combined BG return date",
        order.combinedBgReturnDate,
        context,
      );
    });
    addCustomRuleAnomalies(file, customRules, addIssue);
  });
  return rows.sort(
    (a, b) =>
      a.division.localeCompare(b.division) ||
      a.fileRef.localeCompare(b.fileRef) ||
      a.block.localeCompare(b.block),
  );
}

type AddAnomalyPair = (
  block: string,
  rule: string,
  previousField: string,
  previousDate: string | undefined,
  laterField: string,
  laterDate: string | undefined,
  context?: string,
) => void;

type AddAnomalyIssue = (
  block: string,
  rule: string,
  expectedField: string,
  expectedValue: string,
  foundField: string,
  foundValue: string,
  context?: string,
) => void;

function addPreControlReceivedDateAnomalies(
  file: FileRecord,
  fileReceivedDate: string | undefined,
  addPair: AddAnomalyPair,
) {
  const preControlDates: Array<{
    block: string;
    field: string;
    date: string | undefined;
  }> = [
    { block: "Scrutiny", field: "Scrutiny date", date: file.scrutinyDate },
    { block: "Scrutiny", field: "Scrutiny response date", date: file.scrutinyResponseDate },
    { block: "Scrutiny", field: "Scrutiny completion date", date: file.scrutinyCompletionDate },
    { block: "High Value", field: "High value meeting date", date: file.highValueMeetingDate },
    { block: "High Value", field: "High value minutes date", date: file.highValueMinutesDate },
    { block: "TCEC", field: "Pre-TCEC date", date: file.preTcecDate },
    { block: "TCEC", field: "Pre-TCEC minutes date", date: file.preTcecMinutesDate },
    { block: "AD", field: "AD sent date", date: file.adSentDate },
    { block: "AD", field: "AD vetting date", date: file.adVettingDate },
    { block: "R&QA", field: "R&QA sent date", date: file.rqaSentDate },
    { block: "R&QA", field: "R&QA approval date", date: file.rqaApprovalDate },
    { block: "Control", field: "Control date", date: file.immsDate },
  ];

  preControlDates.forEach(({ block, field, date }) => {
    addPair(
      block,
      `${field} should not be before demand received date`,
      "Demand received date",
      fileReceivedDate,
      field,
      date,
    );
  });
}

function addBgAnomalies({
  kind,
  context,
  fileReceivedDate,
  financialSanctionDate,
  soDate,
  bgNo,
  amount,
  receivedDate,
  validityDate,
  returnDate,
  addPair,
  addIssue,
}: {
  kind: "PSB" | "PWB" | "PSB+PWB";
  context: string;
  fileReceivedDate: string | undefined;
  financialSanctionDate: string | undefined;
  soDate: string | undefined;
  bgNo: string | undefined;
  amount: string | undefined;
  receivedDate: string | undefined;
  validityDate: string | undefined;
  returnDate: string | undefined;
  addPair: AddAnomalyPair;
  addIssue: AddAnomalyIssue;
}) {
  const receivedLabel = `${kind} received date`;
  const validityLabel = `${kind} validity date`;
  const returnLabel = `${kind} return date`;
  const earlierThanWorkflowDates = [
    { label: "Demand received date", date: fileReceivedDate },
    { label: "Financial Sanction date", date: financialSanctionDate },
  ].filter((item): item is { label: string; date: string } => {
    const date = item.date;
    return (
      typeof date === "string" && isIsoDate(date) && isIsoDate(receivedDate) && date > receivedDate!
    );
  });
  if (earlierThanWorkflowDates.length) {
    addIssue(
      kind,
      `${kind} received date is earlier than expected workflow dates`,
      "Expected workflow dates",
      earlierThanWorkflowDates.map((item) => `${item.label}: ${item.date}`).join("; "),
      receivedLabel,
      receivedDate!,
      context,
    );
  }
  addPair(
    kind,
    `${kind} received date should not be after ${kind} validity date`,
    receivedLabel,
    receivedDate,
    validityLabel,
    validityDate,
    context,
  );
  addPair(
    kind,
    `${kind} received date should not be after ${kind} return date`,
    receivedLabel,
    receivedDate,
    returnLabel,
    returnDate,
    context,
  );

  if (hasFilledString(validityDate) && !hasFilledString(receivedDate)) {
    addIssue(
      kind,
      `${kind} validity date is filled without received date`,
      "Expected",
      `${kind} received date filled`,
      "Found",
      `${kind} validity date filled`,
      context,
    );
  }
  if (hasFilledString(returnDate) && !hasFilledString(receivedDate)) {
    addIssue(
      kind,
      `${kind} return date is filled without received date`,
      "Expected",
      `${kind} received date filled`,
      "Found",
      `${kind} return date filled`,
      context,
    );
  }
  if ((hasFilledString(receivedDate) || hasFilledString(validityDate)) && !hasFilledString(bgNo)) {
    addIssue(
      kind,
      `${kind} date is filled without BG number`,
      "Expected",
      `${kind} BG number filled`,
      "Found",
      `${kind} date filled`,
      context,
    );
  }
  if (hasFilledString(amount) && !hasFilledString(bgNo)) {
    addIssue(
      kind,
      `${kind} amount is filled without BG number`,
      "Expected",
      `${kind} BG number filled`,
      "Found",
      `${kind} amount filled`,
      context,
    );
  }
}

function isMissingWarrantyPeriodAfterCompletion(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: "pwb" | "psbpwb",
) {
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !hasFilledString(order.warrantyPeriodDate) &&
    isDeliveryOrJobCompletionDone(file, order)
  );
}

function isDeliveryOrJobCompletionDone(file: FileRecord, order: SupplyOrderDetail) {
  if (isJobCompletionWorkflow(file)) return isJobCompletionDone(order);
  return hasFilledString(order.materialReceiptDate);
}

function isBgCategoryApplicable(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: "pwb" | "psbpwb",
) {
  if (category === "pwb") {
    return (
      isYes(file.bg) &&
      (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  return isYes(file.bg) && order.bgCoverageType === "PSB+PWB";
}

function isBgReceivedOrder(order: SupplyOrderDetail, category: "pwb" | "psbpwb") {
  return hasFilledString(
    category === "pwb" ? order.pwbBgReceivedDate : order.combinedBgReceivedDate,
  );
}

function getBgReturnDate(order: SupplyOrderDetail, category: "pwb" | "psbpwb") {
  return category === "pwb" ? order.pwbBgReturnDate : order.combinedBgReturnDate;
}

function hasPaymentAmount(
  order: Pick<SupplyOrderDetail, "actualPaymentCapital" | "actualPaymentRevenue">,
) {
  return hasFilledString(order.actualPaymentCapital) || hasFilledString(order.actualPaymentRevenue);
}

function fileSupplyOrders(file: FileRecord) {
  return file.supplyOrders?.length ? file.supplyOrders : [file as SupplyOrderDetail];
}

function getDuplicateValues(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([value]) => value),
  );
}

function hasCompletedMilestone(milestones: string[] | undefined, target: string) {
  const normalizedTarget = normalizeMilestoneName(target);
  return (milestones ?? []).some(
    (milestone) => normalizeMilestoneName(milestone) === normalizedTarget,
  );
}

function readPositiveInteger(value: string | undefined) {
  if (!hasFilledString(value)) return undefined;
  const parsed = Number.parseInt(value!.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseAmount(value: string | undefined) {
  if (!hasFilledString(value)) return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

type AmountFields = {
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
};

function getActualPaymentValue(
  order: Pick<AmountFields, "actualPaymentCapital" | "actualPaymentRevenue">,
) {
  return parseAmount(order.actualPaymentCapital) + parseAmount(order.actualPaymentRevenue);
}

function getOrderValue(order: AmountFields) {
  return (
    parseAmount(order.soValueCapital) +
    parseAmount(order.soValueRevenue) +
    parseAmount(order.stageAmountCapital) +
    parseAmount(order.stageAmountRevenue)
  );
}

function getExpectedOrderValue(
  file: FileRecord,
  order: Pick<
    AmountFields,
    "soValueCapital" | "soValueRevenue" | "stageAmountCapital" | "stageAmountRevenue"
  >,
) {
  const capital = parseAmount(order.stageAmountCapital) || parseAmount(order.soValueCapital);
  const revenue = parseAmount(order.stageAmountRevenue) || parseAmount(order.soValueRevenue);
  return getRequiredAmountSide(file) === "Revenue" ? revenue : capital;
}

function formatAmountForAnomaly(value: number) {
  return Number.isFinite(value) ? String(value) : "Invalid amount";
}

function getRequiredAmountSide(file: Pick<FileRecord, "valueCapital" | "valueRevenue">) {
  return parseAmount(file.valueRevenue) > 0 ? "Revenue" : "Capital";
}

function getActualAmountSide(
  order: Pick<SupplyOrderDetail, "actualPaymentCapital" | "actualPaymentRevenue">,
) {
  const capital = parseAmount(order.actualPaymentCapital);
  const revenue = parseAmount(order.actualPaymentRevenue);
  if (capital > 0 && revenue > 0) return "Capital and Revenue";
  if (revenue > 0) return "Revenue";
  if (capital > 0) return "Capital";
  return "Blank";
}

function hasWrongAmountSide(
  file: FileRecord,
  order: Pick<SupplyOrderDetail, "actualPaymentCapital" | "actualPaymentRevenue">,
) {
  const required = getRequiredAmountSide(file);
  const capital = parseAmount(order.actualPaymentCapital);
  const revenue = parseAmount(order.actualPaymentRevenue);
  return required === "Revenue" ? capital > 0 : revenue > 0;
}

function hasLaterWorkflowAfterHighValue(file: FileRecord) {
  return hasIfaWorkflow(file) || hasSupplyOrderWorkflow(file);
}

function hasLaterWorkflowAfterTcec(file: FileRecord) {
  return hasIfaWorkflow(file) || hasSupplyOrderWorkflow(file);
}

function hasIfaWorkflow(file: FileRecord) {
  return hasFilledString(file.ifaSentDate) || hasFilledString(file.ifaFinalDate);
}

function hasSupplyOrderWorkflow(file: FileRecord) {
  return fileSupplyOrders(file).some((order) => hasFilledString(order.soDate));
}

function hasAnyBgField(order: SupplyOrderDetail) {
  return [
    order.psbBgNo,
    order.psbBgAmount,
    order.psbBgReceivedDate,
    order.psbBgValidityDate,
    order.psbBgReturnDate,
    order.pwbBgNo,
    order.pwbBgAmount,
    order.pwbBgReceivedDate,
    order.pwbBgValidityDate,
    order.pwbBgReturnDate,
    order.combinedBgNo,
    order.combinedBgAmount,
    order.combinedBgReceivedDate,
    order.combinedBgValidityDate,
    order.combinedBgReturnDate,
  ].some(hasFilledString);
}

function hasWorkflowAfterDate(order: SupplyOrderDetail, date: string | undefined) {
  if (!isIsoDate(date)) return false;
  return [
    order.materialReceiptDate,
    order.jobCompletionDate,
    order.irPreparationDate,
    order.irReceiptDate,
    order.billPreparationDate,
    order.billSentForPaymentDate,
    order.paymentDate,
    ...(order.stageDeliveries ?? []).flatMap((stage) => [
      stage.materialReceiptDate,
      stage.jobCompletionDate,
      stage.irPreparationDate,
      stage.irReceiptDate,
      stage.billPreparationDate,
      stage.billSentForPaymentDate,
      stage.paymentDate,
    ]),
  ].some((value) => isIsoDate(value) && value! > date!);
}

function isStageDone(
  stage: Pick<
    SupplyOrderDetail,
    "completedMilestones" | "materialReceiptDate" | "jobCompletionDate"
  >,
) {
  return (
    hasCompletedMilestone(stage.completedMilestones, "Delivery") ||
    hasCompletedMilestone(stage.completedMilestones, "Job Completion") ||
    hasFilledString(stage.materialReceiptDate) ||
    hasFilledString(stage.jobCompletionDate)
  );
}

function isStageCurrent(stage: Pick<SupplyOrderDetail, "currentMilestone">) {
  const current = normalizeMilestoneName(stage.currentMilestone ?? "");
  return current === "delivery" || current === "jobcompletion";
}

function hasStageCompletion(
  stage: Pick<
    SupplyOrderDetail,
    "completedMilestones" | "materialReceiptDate" | "jobCompletionDate"
  >,
) {
  return isStageDone(stage);
}

function hasStagePaymentOrBillWorkflow(
  stage: Pick<SupplyOrderDetail, "billPreparationDate" | "billSentForPaymentDate" | "paymentDate">,
) {
  return (
    hasFilledString(stage.billPreparationDate) ||
    hasFilledString(stage.billSentForPaymentDate) ||
    hasFilledString(stage.paymentDate)
  );
}

function hasStagePaymentOrAmountFields(
  stage: Pick<
    SupplyOrderDetail,
    | "billPreparationDate"
    | "billSentForPaymentDate"
    | "paymentDate"
    | "paymentMode"
    | "actualPaymentCapital"
    | "actualPaymentRevenue"
  >,
) {
  return (
    hasStagePaymentOrBillWorkflow(stage) ||
    hasSelectablePaymentMode(stage.paymentMode) ||
    hasPaymentAmount(stage)
  );
}

function hasAdvancePaymentData(order: Pick<SupplyOrderDetail, "advancePaymentDetail">) {
  const advance = order.advancePaymentDetail;
  if (!advance) return false;
  return [
    advance.currentMilestone,
    ...(advance.completedMilestones ?? []),
    advance.stageAmountCapital,
    advance.stageAmountRevenue,
    advance.billPreparationDate,
    advance.billSentForPaymentDate,
    advance.paymentDate,
    advance.paymentMode,
    advance.actualPaymentCapital,
    advance.actualPaymentRevenue,
  ].some(hasFilledString);
}

function hasAdvancePaymentDone(order: Pick<SupplyOrderDetail, "advancePaymentDetail">) {
  const advance = order.advancePaymentDetail;
  return Boolean(
    advance?.paymentDate ||
    advance?.completedMilestones?.some(
      (milestone) => normalizeMilestoneName(milestone) === "advancepayment",
    ),
  );
}

function isAdvancePaymentWorkflowComplete(order: Pick<SupplyOrderDetail, "advancePaymentDetail">) {
  const advance = order.advancePaymentDetail;
  if (!advance) return false;
  return (
    getOrderValue(advance) > 0 &&
    hasFilledString(advance.billPreparationDate) &&
    hasFilledString(advance.billSentForPaymentDate) &&
    hasFilledString(advance.paymentDate) &&
    hasSelectablePaymentMode(advance.paymentMode) &&
    hasPaymentAmount(advance)
  );
}

function hasBgReturnPendingForAnyCategory(order: SupplyOrderDetail) {
  return (
    (hasFilledString(order.psbBgReceivedDate) && !hasFilledString(order.psbBgReturnDate)) ||
    (hasFilledString(order.pwbBgReceivedDate) && !hasFilledString(order.pwbBgReturnDate)) ||
    (hasFilledString(order.combinedBgReceivedDate) && !hasFilledString(order.combinedBgReturnDate))
  );
}

function hasWarrantyBgApplicable(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isBgCategoryApplicable(file, order, "pwb") || isBgCategoryApplicable(file, order, "psbpwb")
  );
}

function getDeliveryOrJobCompletionDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isJobCompletionWorkflow(file)) return order.jobCompletionDate;
  return order.materialReceiptDate;
}

function isPaymentBeforeDeliveryEquivalent(file: FileRecord, order: SupplyOrderDetail) {
  const completionDate = getDeliveryOrJobCompletionDate(file, order);
  return (
    isIsoDate(order.paymentDate) &&
    isIsoDate(completionDate) &&
    order.paymentDate! < completionDate!
  );
}

function addWarrantyBufferAnomalies(
  file: FileRecord,
  order: SupplyOrderDetail,
  context: string,
  addIssue: AddAnomalyIssue,
) {
  const bufferDays = 60;
  const warrantyDate = order.warrantyPeriodDate;
  if (!hasFilledString(warrantyDate)) return;
  const requiredDate = addDaysIso(warrantyDate, bufferDays);
  if (!requiredDate) return;
  [
    {
      kind: "PWB",
      applicable: isBgCategoryApplicable(file, order, "pwb"),
      validityDate: order.pwbBgValidityDate,
      returnDate: order.pwbBgReturnDate,
    },
    {
      kind: "PSB+PWB",
      applicable: isBgCategoryApplicable(file, order, "psbpwb"),
      validityDate: order.combinedBgValidityDate,
      returnDate: order.combinedBgReturnDate,
    },
  ].forEach(({ kind, applicable, validityDate, returnDate }) => {
    if (!applicable) return;
    if (hasFilledString(validityDate) && validityDate! < requiredDate) {
      addIssue(
        "Warranty / BG mismatch",
        `${kind} validity date is earlier than Warranty Period + 60 days`,
        "Required validity date",
        requiredDate,
        `${kind} validity date`,
        validityDate!,
        context,
      );
    }
    if (hasFilledString(returnDate) && returnDate! < requiredDate) {
      addIssue(
        "Warranty / BG mismatch",
        `${kind} returned before Warranty Period + 60 days is over`,
        "Earliest return date",
        requiredDate,
        `${kind} return date`,
        returnDate!,
        context,
      );
    }
    if (!hasFilledString(returnDate) && isIsoDate(requiredDate) && requiredDate < todayIsoDate()) {
      addIssue(
        "Warranty / BG mismatch",
        `${kind} return date missing after Warranty Period + 60 days`,
        `${kind} return date`,
        "Filled",
        "Warranty Period + 60 days",
        requiredDate,
        context,
      );
    }
  });
}

function addDaysIso(value: string | undefined, days: number) {
  if (!isIsoDate(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getAnomalyFileRef(file: FileRecord) {
  return file.uniqueCode || file.fileNo || file.title || file.id;
}

function normalizeAnomalyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseAnomalySignature(signature: string) {
  const [
    fileId = "",
    context = "",
    ruleKey = "",
    previousField = "",
    previousValue = "",
    laterField = "",
    laterValue = "",
  ] = signature.split("|");
  return {
    fileId,
    context,
    ruleKey,
    ruleLabel: humanizeAnomalyRuleKey(ruleKey),
    previousField,
    previousValue,
    laterField,
    laterValue,
  };
}

function humanizeAnomalyRuleKey(ruleKey: string) {
  if (!ruleKey) return "";
  const compactReplacements: Array<[RegExp, string]> = [
    [/fileclosedbutbgreturnpendingexists/g, "File is closed but BG return is still pending"],
    [/bgreturnpending/g, "BG return pending"],
    [/fileclosed/g, "File closed"],
    [/exists/g, "exists"],
    [/demandreceived/g, "Demand received"],
    [/filereceived/g, "File received"],
    [/prebidmeeting/g, "Pre-Bid Meeting"],
    [/jobcompletion/g, "Job Completion"],
    [/financialsanction/g, "Financial Sanction"],
    [/supplyorder/g, "Supply Order"],
  ];
  let label = ruleKey;
  compactReplacements.forEach(([pattern, replacement]) => {
    label = label.replace(pattern, replacement);
  });
  return label
    .replace(/date/g, " date ")
    .replace(/should/g, " should ")
    .replace(/not/g, " not ")
    .replace(/after/g, " after ")
    .replace(/before/g, " before ")
    .replace(/filled/g, " filled ")
    .replace(/blank/g, " blank ")
    .replace(/current/g, " current ")
    .replace(/done/g, " done ")
    .replace(/bg/g, " BG ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (value) => value.toUpperCase());
}

function isAnomalySuppressed(
  signature: string,
  ruleKey: string,
  suppressions: AnomalySuppressions,
) {
  return suppressions.signatures.has(signature) || suppressions.universalRuleKeys.has(ruleKey);
}

const customAnomalyFieldDefinitions = [
  { key: "file.receivedDate", label: "Demand received date", scope: "file" },
  { key: "file.scrutinyDate", label: "Scrutiny date", scope: "file" },
  { key: "file.scrutinyResponseDate", label: "Scrutiny response date", scope: "file" },
  { key: "file.scrutinyCompletionDate", label: "Scrutiny completion date", scope: "file" },
  { key: "file.immsDate", label: "Control date", scope: "file" },
  { key: "file.highValueMeetingDate", label: "High value meeting date", scope: "file" },
  { key: "file.highValueMinutesDate", label: "High value minutes date", scope: "file" },
  { key: "file.adSentDate", label: "AD sent date", scope: "file" },
  { key: "file.adVettingDate", label: "AD vetting date", scope: "file" },
  { key: "file.rqaSentDate", label: "R&QA sent date", scope: "file" },
  { key: "file.rqaApprovalDate", label: "R&QA approval date", scope: "file" },
  { key: "file.ifaSentDate", label: "IFA sent date", scope: "file" },
  { key: "file.ifaFinalDate", label: "IFA final date", scope: "file" },
  { key: "file.cfaSentDate", label: "CFA sent date", scope: "file" },
  { key: "file.cfaDate", label: "CFA date", scope: "file" },
  { key: "file.cncDate", label: "CNC date", scope: "file" },
  { key: "file.cncApprovalDate", label: "CNC approval date", scope: "file" },
  { key: "file.fileClosureDate", label: "File closure date", scope: "file" },
  { key: "order.soDate", label: "S.O. date", scope: "supply_order" },
  { key: "order.dpDate", label: "D.P. date", scope: "supply_order" },
  { key: "order.revisedDp", label: "Revised D.P.", scope: "supply_order" },
  { key: "order.materialReceiptDate", label: "Material receipt date", scope: "supply_order" },
  { key: "order.jobCompletionDate", label: "Job completion date", scope: "supply_order" },
  { key: "order.irPreparationDate", label: "IR preparation date", scope: "supply_order" },
  { key: "order.irReceiptDate", label: "IR receipt date", scope: "supply_order" },
  { key: "order.billPreparationDate", label: "Bill preparation date", scope: "supply_order" },
  {
    key: "order.billSentForPaymentDate",
    label: "Bill sent for payment date",
    scope: "supply_order",
  },
  { key: "order.paymentDate", label: "Payment date", scope: "supply_order" },
] as const;

function getCustomAnomalyFieldDefinition(key: string) {
  return customAnomalyFieldDefinitions.find((field) => field.key === key);
}

function getCustomAnomalyFieldValue(
  key: string,
  file: FileRecord,
  order?: SupplyOrderDetail,
): string | undefined {
  const definition = getCustomAnomalyFieldDefinition(key);
  if (!definition) return undefined;
  if (definition.scope === "file")
    return (
      String((file as unknown as Record<string, unknown>)[key.replace("file.", "")] ?? "") ||
      undefined
    );
  if (!order) return undefined;
  return (
    String((order as unknown as Record<string, unknown>)[key.replace("order.", "")] ?? "") ||
    undefined
  );
}

function getCustomAnomalyFieldLabel(key: string) {
  return getCustomAnomalyFieldDefinition(key)?.label ?? key;
}

function addCustomRuleAnomalies(
  file: FileRecord,
  rules: CustomAnomalyRule[],
  addIssue: AddAnomalyIssue,
) {
  rules
    .filter((rule) => rule.enabled)
    .forEach((rule) => {
      const fieldA = getCustomAnomalyFieldDefinition(rule.fieldA);
      const fieldB = rule.fieldB ? getCustomAnomalyFieldDefinition(rule.fieldB) : undefined;
      if (!fieldA) return;
      const evaluate = (order: SupplyOrderDetail | undefined, context: string) => {
        const valueA = getCustomAnomalyFieldValue(rule.fieldA, file, order);
        const valueB = rule.fieldB
          ? getCustomAnomalyFieldValue(rule.fieldB, file, order)
          : undefined;
        const labelA = getCustomAnomalyFieldLabel(rule.fieldA);
        const labelB = rule.fieldB ? getCustomAnomalyFieldLabel(rule.fieldB) : "Required value";
        if (rule.ruleType === "date_order") {
          if (!fieldB || !isIsoDate(valueA) || !isIsoDate(valueB)) return;
          const violates =
            rule.operator === "not_before"
              ? valueA! < valueB!
              : rule.operator === "not_after"
                ? valueA! > valueB!
                : false;
          if (!violates) return;
          addIssue(
            "Custom rule",
            rule.name,
            labelA,
            rule.operator === "not_before" ? `On/after ${labelB}` : `On/before ${labelB}`,
            labelA,
            valueA!,
            context,
          );
        } else if (rule.ruleType === "required_field") {
          if (!fieldB || !hasFilledString(valueA) || hasFilledString(valueB)) return;
          addIssue("Custom rule", rule.name, labelB, "Filled", labelB, "Blank", context);
        } else if (rule.ruleType === "delay_days") {
          if (
            !fieldB ||
            !isIsoDate(valueA) ||
            !isIsoDate(valueB) ||
            !Number.isFinite(rule.thresholdDays)
          )
            return;
          const start = new Date(`${valueB}T00:00:00.000Z`);
          const end = new Date(`${valueA}T00:00:00.000Z`);
          const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
          if (days <= (rule.thresholdDays ?? 0)) return;
          addIssue(
            "Custom rule",
            rule.name,
            labelA,
            `Within ${rule.thresholdDays} days of ${labelB}`,
            labelA,
            `${valueA} (${days} days)`,
            context,
          );
        } else if (rule.ruleType === "date_boundary") {
          if (!isIsoDate(valueA) || !isIsoDate(rule.fixedValue)) return;
          const violates =
            rule.operator === "not_before_fixed"
              ? valueA! < rule.fixedValue!
              : rule.operator === "not_after_fixed"
                ? valueA! > rule.fixedValue!
                : false;
          if (!violates) return;
          addIssue(
            "Custom rule",
            rule.name,
            labelA,
            rule.operator === "not_before_fixed"
              ? `On/after ${rule.fixedValue}`
              : `On/before ${rule.fixedValue}`,
            labelA,
            valueA!,
            context,
          );
        }
      };
      if (fieldA.scope === "file" && (!fieldB || fieldB.scope === "file")) {
        evaluate(undefined, `custom-rule:${rule.id}`);
        return;
      }
      fileSupplyOrders(file).forEach((order, index) => {
        if (isYes(order.soCancelled)) return;
        evaluate(order, `custom-rule:${rule.id}:so:${index}`);
      });
    });
}

function getCanonicalAnomalyContext(context: string) {
  return context.replace(/:\d+$/, "");
}

async function loadDivisions(user: ReturnType<typeof requireAuth>, financialYear: string) {
  const scopeKey = canUseAllDivisions(user) ? "all" : user.divisionIds.join(",");
  return getCached(
    `divisions:dashboard:${financialYear}:${scopeKey}`,
    cacheTtl.divisionsMs,
    async () => {
      const values: unknown[] = [];
      const conditions = ["coalesce(a.active, false)", "d.archived_at is null"];
      if (!canUseAllDivisions(user)) {
        if (user.divisionIds.length) {
          values.push(user.divisionIds);
          conditions.push(`d.id = any($${values.length}::uuid[])`);
        } else {
          conditions.push("false");
        }
      }
      values.push(financialYear);
      const yearParam = values.length;
      const result = await pool.query<DivisionRow>(
        `select
           d.id,
           d.name,
           d.code,
           coalesce(a.allocated_capital, d.allocated_capital) as allocated_capital,
           coalesce(a.allocated_revenue, d.allocated_revenue) as allocated_revenue,
           d.ad
         from divisions d
         left join division_year_allocations a
           on a.division_id = d.id and a.financial_year = $${yearParam}::text
         where ${conditions.join(" and ")}
         order by d.name asc`,
        values,
      );
      return result.rows.map(mapDivision);
    },
  );
}

async function loadSettings() {
  return getCached("settings:dashboard", cacheTtl.settingsMs, async () => {
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, file_type_groups, modes, milestones, table_field_presets, active_user_id
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0]);
  });
}

async function ensureAnomalyGovernanceSchema() {
  anomalyGovernanceSchemaReady ??= (async () => {
    await pool.query(`
      alter table suspected_anomaly_acceptances
        add column if not exists rule_key text,
        add column if not exists file_id text,
        add column if not exists status text not null default 'approved_file',
        add column if not exists scope text not null default 'file',
        add column if not exists requested_by_user_id uuid references app_users(id) on delete set null,
        add column if not exists requested_by_name text,
        add column if not exists requested_at timestamptz not null default now(),
        add column if not exists reviewed_by_user_id uuid references app_users(id) on delete set null,
        add column if not exists reviewed_by_name text,
        add column if not exists reviewed_at timestamptz,
        add column if not exists revoked_by_user_id uuid references app_users(id) on delete set null,
        add column if not exists revoked_by_name text,
        add column if not exists revoked_at timestamptz,
        add column if not exists admin_message text,
        add column if not exists history_hidden_by_user_ids uuid[] not null default '{}',
        add column if not exists admin_history_cleared_at timestamptz,
        add column if not exists admin_history_cleared_by_user_id uuid references app_users(id) on delete set null,
        add column if not exists admin_history_cleared_by_name text
    `);
    await pool.query(`
      update suspected_anomaly_acceptances
      set
        status = coalesce(nullif(status, ''), 'approved_file'),
        scope = coalesce(nullif(scope, ''), 'file'),
        requested_by_user_id = coalesce(requested_by_user_id, accepted_by_user_id),
        requested_by_name = coalesce(requested_by_name, accepted_by_name),
        requested_at = coalesce(requested_at, accepted_at),
        reviewed_by_user_id = coalesce(reviewed_by_user_id, accepted_by_user_id),
        reviewed_by_name = coalesce(reviewed_by_name, accepted_by_name),
        reviewed_at = coalesce(reviewed_at, accepted_at)
      where true
    `);
    await pool.query(`
      create table if not exists anomaly_rules (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        description text not null default '',
        rule_type text not null,
        field_a text not null,
        operator text not null,
        field_b text,
        fixed_value text,
        threshold_days integer,
        severity text not null default 'Medium',
        scope text not null default 'all',
        enabled boolean not null default true,
        created_by_user_id uuid references app_users(id) on delete set null,
        created_by_name text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query(`alter table anomaly_rules add column if not exists fixed_value text`);
  })();
  await anomalyGovernanceSchemaReady;
}

async function loadCustomAnomalyRules() {
  await ensureAnomalyGovernanceSchema();
  const result = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    rule_type: string;
    field_a: string;
    operator: string;
    field_b: string | null;
    fixed_value: string | null;
    threshold_days: number | null;
    severity: string;
    scope: string;
    enabled: boolean;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
  }>(`
    select id, name, description, rule_type, field_a, operator, field_b, fixed_value, threshold_days,
           severity, scope, enabled, created_by_name, created_at, updated_at
    from anomaly_rules
    order by created_at desc
  `);
  return result.rows.map(mapCustomAnomalyRule);
}

function mapCustomAnomalyRule(row: {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  field_a: string;
  operator: string;
  field_b: string | null;
  fixed_value: string | null;
  threshold_days: number | null;
  severity: string;
  scope: string;
  enabled: boolean;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}): CustomAnomalyRule {
  return {
    id: row.id,
    name: row.name,
    description: fromDbText(row.description),
    ruleType: normalizeCustomRuleType(row.rule_type),
    fieldA: row.field_a,
    operator: row.operator,
    fieldB: fromDbText(row.field_b),
    fixedValue: fromDbText(row.fixed_value),
    thresholdDays: row.threshold_days ?? undefined,
    severity: normalizeCustomRuleSeverity(row.severity),
    scope: normalizeCustomRuleScope(row.scope),
    enabled: row.enabled,
    createdByName: fromDbText(row.created_by_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadValueThresholdLevels(financialYear: string): Promise<ValueThresholdLevel[]> {
  return getCached(`lookup:value-thresholds:${financialYear}`, cacheTtl.lookupMs, async () => {
    const result = await pool.query<{
      id: string;
      level_number: number;
      label: string;
      min_value: string | null;
      max_value: string | null;
      applies_to: ValueThresholdLevel["appliesTo"];
    }>(
      `select id, level_number, label, min_value, max_value, applies_to
       from value_threshold_levels
       where financial_year = $1::text
       order by level_number asc`,
      [financialYear],
    );
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      levelNumber: row.level_number,
      minValue: fromDbText(row.min_value) || undefined,
      maxValue: fromDbText(row.max_value) || undefined,
      appliesTo: row.applies_to,
    }));
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeCustomRuleType(value: string): CustomAnomalyRule["ruleType"] {
  return value === "required_field" || value === "delay_days" || value === "date_boundary"
    ? value
    : "date_order";
}

function normalizeCustomRuleSeverity(value: string): CustomAnomalyRule["severity"] {
  return value === "Low" || value === "High" ? value : "Medium";
}

function normalizeCustomRuleScope(value: string): CustomAnomalyRule["scope"] {
  return value === "file" || value === "supply_order" ? value : "all";
}

function validateCustomAnomalyRuleInput(body: Record<string, unknown>) {
  const source = body;
  const name = readString(source.name)?.trim();
  const description = readString(source.description)?.trim() ?? "";
  const ruleType = normalizeCustomRuleType(readString(source.ruleType) ?? "");
  const fieldA = readString(source.fieldA)?.trim() ?? "";
  const operator = readString(source.operator)?.trim() ?? "";
  const fieldB = readString(source.fieldB)?.trim() ?? "";
  const fixedValue = normalizeDateLiteral(readString(source.fixedValue)?.trim());
  const thresholdDays =
    typeof source.thresholdDays === "number"
      ? source.thresholdDays
      : Number.parseInt(readString(source.thresholdDays) ?? "", 10);
  const severity = normalizeCustomRuleSeverity(readString(source.severity) ?? "");
  const scope = normalizeCustomRuleScope(readString(source.scope) ?? "");
  const enabled = typeof source.enabled === "boolean" ? source.enabled : true;
  if (!name) throw new HttpError(400, "Rule name is required.");
  if (!getCustomAnomalyFieldDefinition(fieldA)) throw new HttpError(400, "Field A is invalid.");
  if (
    (ruleType === "date_order" || ruleType === "required_field" || ruleType === "delay_days") &&
    !getCustomAnomalyFieldDefinition(fieldB)
  ) {
    throw new HttpError(400, "Field B is invalid.");
  }
  if (ruleType === "date_order" && operator !== "not_before" && operator !== "not_after") {
    throw new HttpError(400, "Date order operator must be not_before or not_after.");
  }
  if (ruleType === "required_field" && operator !== "requires") {
    throw new HttpError(400, "Required field operator must be requires.");
  }
  if (ruleType === "delay_days" && (!Number.isInteger(thresholdDays) || thresholdDays < 0)) {
    throw new HttpError(400, "Delay rule needs a non-negative threshold.");
  }
  if (ruleType === "date_boundary") {
    if (operator !== "not_before_fixed" && operator !== "not_after_fixed") {
      throw new HttpError(
        400,
        "Date boundary operator must be not_before_fixed or not_after_fixed.",
      );
    }
    if (!isIsoDate(fixedValue)) throw new HttpError(400, "Date boundary rule needs a fixed date.");
  }
  return {
    name,
    description,
    ruleType,
    fieldA,
    operator,
    fieldB,
    fixedValue,
    thresholdDays: ruleType === "delay_days" ? thresholdDays : undefined,
    severity,
    scope,
    enabled,
  };
}

function normalizeDateLiteral(value: string | undefined) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return value;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const fileClosedMilestone = "File Closed";
const protectedLiveStatusMilestones = [
  "Refloat bidding",
  "Refloat Post-TCEC",
  "Bill returned for correction",
  "Supplementary bill returned for correction",
  "Job Completion",
];

function isFileActiveInYear(file: { year?: string; activeYears?: string[] }, year: string) {
  return file.year === year || file.activeYears?.includes(year);
}

function isPaymentCompletedFile(file: { completedMilestones?: string[] }) {
  return Boolean(
    file.completedMilestones?.some((milestone) => milestone.trim().toLowerCase() === "payment"),
  );
}

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasSelectablePaymentMode(value: string | undefined) {
  const normalized = value?.trim();
  return Boolean(normalized && normalized.toLowerCase() !== "select");
}

function hasPaymentDetailApartFromMode(
  order: Pick<
    SupplyOrderDetail,
    | "billPreparationDate"
    | "billSentForPaymentDate"
    | "actualPaymentCapital"
    | "actualPaymentRevenue"
  >,
) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    hasPaymentAmount(order)
  );
}

function isInactiveFile(
  file: Pick<
    FileRecord,
    "completedMilestones" | "demandCancelled" | "soCancelled" | "supplyOrders"
  >,
) {
  return (
    isPaymentCompletedFile(file) ||
    isYes(file.demandCancelled) ||
    ((file.supplyOrders?.length ?? 0) === 0 && isYes(file.soCancelled)) ||
    Boolean(
      file.supplyOrders?.length &&
      file.supplyOrders.every((order: SupplyOrderDetail) => isYes(order.soCancelled)),
    )
  );
}

function readList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return undefined;
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
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

function activeFilesExpression() {
  return `(not ${fileClosedExpression()}
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes')`;
}

function getSelectedYearCondition(
  selectedYear: string | undefined,
  values: unknown[],
  currentFinancialYear?: string,
) {
  if (!selectedYear) return undefined;
  if (selectedYear === allActiveFilesYear) {
    return activeFilesExpression();
  }
  if (selectedYear === activePlusCurrentFyClosedYear) {
    const range = getFinancialYearDateRange(currentFinancialYear);
    if (!range) return activeFilesExpression();
    const start = addValue(values, range.start);
    const end = addValue(values, range.end);
    return `(${activeFilesExpression()} or (${fileClosedExpression()}
      and f.file_closure_date between ${start}::date and ${end}::date
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes'))`;
  }

  const placeholder = addValue(values, selectedYear);
  return `(f.year = ${placeholder}::text or exists (
    select 1 from file_year_activity a
    where a.file_id = f.id and a.financial_year = ${placeholder}::text and a.status = 'active'
  ))`;
}

function getDashboardFileWhereSql({
  scopeSql,
  scopeValues,
  selectedYear,
  currentFinancialYear,
  activeDivision,
  activeAnalyticsDivision,
  fileCategories,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  currentFinancialYear?: string;
  activeDivision: string;
  activeAnalyticsDivision: string;
  fileCategories: FileCategoryKey[];
}) {
  const conditions: string[] = [];
  const values = [...scopeValues];
  if (scopeSql) conditions.push(scopeSql);

  const selectedYearCondition = getSelectedYearCondition(
    selectedYear,
    values,
    currentFinancialYear,
  );
  if (selectedYearCondition) conditions.push(selectedYearCondition);

  if (activeDivision !== "all") {
    const divisionNames = Array.from(
      new Set(
        [activeDivision, activeAnalyticsDivision === "all" ? undefined : activeAnalyticsDivision]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase()),
      ),
    );
    if (divisionNames.length) {
      const placeholder = addValue(values, divisionNames);
      conditions.push(`lower(coalesce(d.name, '')) = any(${placeholder}::text[])`);
    }
  }

  conditions.push(getFileCategoryCondition(fileCategories));

  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
  };
}

function getFileCategoryCondition(categories: FileCategoryKey[]) {
  if (categories.length === 0) return "false";
  const categorySet = new Set(categories);
  const predicates: string[] = [];
  if (categorySet.has("goodsServices")) {
    predicates.push(
      `lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`,
    );
  }
  if (categorySet.has("amc")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'amc'`);
  }
  if (categorySet.has("mpc")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'mpc'`);
  }
  if (categorySet.has("cars")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'cars'`);
  }
  if (categorySet.has("om")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'o&m'`);
  }
  return predicates.length ? `(${predicates.join(" or ")})` : "false";
}

function appendDashboardWhereClause(whereSql: string, extraConditions: string[] = []) {
  const conditions = ["f.archived_at is null", ...extraConditions];
  if (!whereSql.trim()) return `where ${conditions.join(" and ")}`;
  return `${whereSql} and ${conditions.join(" and ")}`;
}

function countFilter(condition: string) {
  return `count(*) filter (where ${condition})::integer`;
}

function isYesExpression(column: string) {
  return `lower(coalesce(${column}, '')) = 'yes'`;
}

function isNoExpression(column: string) {
  return `lower(coalesce(${column}, '')) = 'no'`;
}

type SimpleDashboardCounts = {
  dashboardFileCount: number;
  modeCounts: Array<{ name: string; count: number }>;
  gemBiddingModeCounts: Array<{ name: string; count: number }>;
  topSummaryStats: Array<{
    label: string;
    value: Array<{ label: string; value: number; searchFilter: string }>;
    hint: string;
  }>;
};

type FinanceTotals = {
  allocatedCapital: number;
  allocatedRevenue: number;
  bookedCapital: number;
  bookedRevenue: number;
  projectedCapital: number;
  projectedRevenue: number;
  spentCapital: number;
  spentRevenue: number;
  paidCapital: number;
  paidRevenue: number;
  advanceCapital: number;
  advanceRevenue: number;
};

type MiscellaneousCounts = {
  liveFiles: number;
  fileClosed: number;
  ld: number;
  demandCancelled: number;
  soCancelled: number;
  shortclosedSo: number;
  multipleSupplyOrders: number;
};

type StatusCounts = {
  milestoneRows: Array<{
    key: string;
    total: number;
    underProcess: number;
    active: number;
    pending: number;
    reviewed: number;
    cleared: number;
  }>;
  liveBids: number;
  overdueBids: number;
  inProcessBids: number;
  liveSupplyOrders: number;
  financialSanctionPending: number;
  financialSanctionCompleted: number;
  deliveryCompleted: number;
  deliveryDue: number;
  deliveryOverdue: number;
  jobCompletionCompleted: number;
  jobCompletionLive: number;
  jobCompletionPeriodOver: number;
  deliveryPeriodValid: number;
  deliveryPeriodExpired: number;
  deliveryPeriodExtended: number;
  irPreparationPending: number;
  irReceiptPending: number;
  irCompleted: number;
};

type CountAnalyticsRow = { name: string; count: number };
type MonthWiseSupplyOrderAnalyticsRow = CountAnalyticsRow & { monthKey: string };
type MonthWiseDeliveryScheduleAnalyticsRow = {
  name: string;
  monthKey: string;
  grossCount: number;
  netCount: number;
};
type ValueAnalyticsRow = { name: string; value: number };
type AverageDaysAnalyticsRow = {
  name: string;
  averageDays: number;
  cumulativeDays?: number;
  minDays?: number;
  maxDays?: number;
  medianDays?: number;
  sampleSize: number;
  sortOrder?: number;
};
type ThresholdAnalyticsRow = {
  name: string;
  source: "demand" | "supplyOrder";
  appliesTo: string;
  range: string;
  count: number;
  capitalCount: number;
  revenueCount: number;
  capital: number;
  revenue: number;
  value: number;
  countContribution: number;
  capitalCountContribution: number;
  revenueCountContribution: number;
  capitalContribution: number;
  revenueContribution: number;
  valueContribution: number;
};
type DivisionValueAnalyticsRow = {
  name: string;
  allocatedCapital: number;
  allocatedRevenue: number;
  allocatedTotal: number;
  intendedCapital: number;
  intendedRevenue: number;
  intendedTotal: number;
  bookedCapital: number;
  bookedRevenue: number;
  bookedTotal: number;
  committedCapital: number;
  committedRevenue: number;
  committedTotal: number;
};

type AnalyticsSqlSlice = {
  divisionFileRanking: CountAnalyticsRow[];
  divisionValueRanking: DivisionValueAnalyticsRow[];
  divisionTurnaroundRanking: AverageDaysAnalyticsRow[];
  topFirmSupplyOrders: ValueAnalyticsRow[];
  topIndentorsByFiles: CountAnalyticsRow[];
  topIndentorsByValue: ValueAnalyticsRow[];
  milestoneClearingRanking: AverageDaysAnalyticsRow[];
  monthlyFileInflow: CountAnalyticsRow[];
  monthWiseSupplyOrder: MonthWiseSupplyOrderAnalyticsRow[];
  monthWiseDeliverySchedule: MonthWiseDeliveryScheduleAnalyticsRow[];
  biddingModeMix: CountAnalyticsRow[];
  fileValueThresholds: ThresholdAnalyticsRow[];
  soValueThresholds: ThresholdAnalyticsRow[];
  divisionRiskRanking: CountAnalyticsRow[];
  divisionPaymentPendingRanking: CountAnalyticsRow[];
};

type SuspectedAnomalyRow = {
  signature: string;
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  block: string;
  rule: string;
  ruleKey: string;
  previousField: string;
  previousDate: string;
  laterField: string;
  laterDate: string;
  accepted: "No";
  requestStatus?: string;
  userExplanation?: string;
  adminMessage?: string;
  requestedByName?: string;
  requestedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  scope?: string;
};

type AnomalySuppressions = {
  signatures: Set<string>;
  universalRuleKeys: Set<string>;
};

type CustomAnomalyRule = {
  id: string;
  name: string;
  description: string;
  ruleType: "date_order" | "required_field" | "delay_days" | "date_boundary";
  fieldA: string;
  operator: string;
  fieldB?: string;
  fixedValue?: string;
  thresholdDays?: number;
  severity: "Low" | "Medium" | "High";
  scope: "all" | "file" | "supply_order";
  enabled: boolean;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ManualMilestoneSqlSlice = {
  manualMilestoneFlow: Array<{ name: string; label: string; current: number; completed: number }>;
  visibleLiveMilestoneNames: string[];
  liveStatusRows: Array<{
    division: string;
    counts: Record<string, number>;
    total: number;
  }>;
};

async function loadSimpleDashboardCounts({
  whereSql,
  values,
  activeDivision,
  modes,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
  modes: string[];
}): Promise<SimpleDashboardCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  extraConditions.push(`not ${isCancelledExpression()}`);

  const modeNames = getConfiguredModeNames(modes);
  const modeSelects = modeNames.map(
    (mode, index) =>
      `${countFilter(`upper(trim(coalesce(f.mode, ''))) = ${literalSql(mode)}`)} as mode_${index}`,
  );
  const gemBiddingModeSelects = gemBiddingModeOptions.map(
    (mode, index) =>
      `${countFilter(`${isYesExpression("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = ${literalSql(mode.toLowerCase())}`)} as gem_bidding_mode_${index}`,
  );
  const attributeSelects = snapshotAttributeDefinitions.flatMap((attribute, index) => [
    `${countFilter("condition" in attribute ? attribute.condition : isYesExpression(attribute.column))} as attribute_${index}_yes`,
    `${countFilter("condition" in attribute ? `not (${attribute.condition})` : isNoExpression(attribute.column))} as attribute_${index}_no`,
  ]);
  const result = await pool.query<Record<string, number | string>>(
    `select
       count(*)::integer as dashboard_file_count,
       ${[...modeSelects, ...gemBiddingModeSelects, ...attributeSelects].join(",\n       ")}
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);

  return {
    dashboardFileCount: readCount("dashboard_file_count"),
    modeCounts: modeNames.map((name, index) => ({ name, count: readCount(`mode_${index}`) })),
    gemBiddingModeCounts: gemBiddingModeOptions.map((name, index) => ({
      name,
      count: readCount(`gem_bidding_mode_${index}`),
    })),
    topSummaryStats: snapshotAttributeDefinitions.map((attribute, index) => ({
      label: attribute.label,
      value: [
        {
          label: attribute.yesLabel,
          value: readCount(`attribute_${index}_yes`),
          searchFilter: `attribute:${attribute.key}:yes`,
        },
        {
          label: attribute.noLabel,
          value: readCount(`attribute_${index}_no`),
          searchFilter: `attribute:${attribute.key}:no`,
        },
      ],
      hint: `${attribute.yesLabel} and ${attribute.noLabel} files`,
    })),
  };
}

function literalSql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function getConfiguredModeNames(modes: string[] | undefined) {
  const seen = new Set<string>();
  return (modes?.length ? modes : defaultModeNames)
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode) => {
      if (!mode) return false;
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    });
}

function inrAmountExpression(column: string) {
  return `case
    when ${column} is null then 0
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${column}
    when f.exchange_rate > 0 then ${column} * f.exchange_rate
    else 0
  end`;
}

function isCancelledExpression() {
  return `(${isYesExpression("f.demand_cancelled")}
    or (${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesExpression("so_active.so_cancelled")}
    )))`;
}

function isSoCancelledExpression() {
  return `(${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesExpression("so_active.so_cancelled")}
    ))`;
}

function hasFilledExpression(column: string) {
  return `coalesce(${column}::text, '') <> ''`;
}

function supplyOrderExists(condition: string) {
  return `exists (
    select 1 from supply_orders so
    where so.file_id = f.id and ${condition}
  )`;
}

function supplyOrderRowExists() {
  return `exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)`;
}

function supplyOrderChildExpression(childCondition: string, _unusedFileLevelCondition?: string) {
  return supplyOrderExists(childCondition);
}

function effectiveDpDateExpression(alias: string) {
  return `coalesce(${alias}.revised_dp, ${alias}.dp_date)`;
}

function supplyOrderPlacedExpression() {
  return supplyOrderChildExpression(
    hasFilledExpression("so.so_date"),
    hasFilledExpression("f.so_date"),
  );
}

function deliveryDueOrderExpression(extraCondition = "true") {
  return supplyOrderChildExpression(
    `${hasFilledExpression("so.so_date")}
     and not ${hasFilledExpression("so.material_receipt_date")}
     and not ${isYesExpression("so.so_cancelled")}
     and ${extraCondition}`,
    `${hasFilledExpression("f.so_date")}
     and not ${hasFilledExpression("f.material_receipt_date")}
     and not ${isYesExpression("f.so_cancelled")}
     and ${extraCondition.replaceAll("so.", "f.")}`,
  );
}

function deliveryInspectionApplicableExpression() {
  return `${isYesExpression("f.ir")} and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
}

function effectiveOrderCancelledExpression(alias = "eso") {
  return `(${isYesExpression(`${alias}.file_demand_cancelled`)}
    or ${isYesExpression(`${alias}.so_cancelled`)})`;
}

function effectiveOrderDpDateExpression(alias = "eso") {
  return `coalesce(${alias}.revised_dp, ${alias}.dp_date)`;
}

function effectiveOrderPlacedExpression(alias = "eso") {
  return hasFilledExpression(`${alias}.so_date`);
}

function effectiveOrderCurrentMilestoneExpression(milestone: string, alias = "eso") {
  return `${normalizeMilestoneExpression(`${alias}.current_milestone`)} = '${normalizeMilestoneName(
    milestone,
  )}'`;
}

function effectiveOrderCompletedMilestoneExpression(milestone: string, alias = "eso") {
  if (normalizeMilestoneName(milestone) === "financialsanction") {
    return hasFilledExpression(`${alias}.financial_sanction_date`);
  }
  if (normalizeMilestoneName(milestone) === "jobcompletion") {
    return hasFilledExpression(`${alias}.job_completion_date`);
  }
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${alias}.completed_milestones, '[]'::jsonb)) as completed(milestone)
    where ${normalizeMilestoneExpression("completed.milestone")} = '${normalizeMilestoneName(milestone)}'
  )`;
}

function completedOrderMilestoneExpression(orderAlias: string, milestone: string) {
  if (normalizeMilestoneName(milestone) === "financialsanction") {
    return hasFilledExpression(`${orderAlias}.financial_sanction_date`);
  }
  if (normalizeMilestoneName(milestone) === "jobcompletion") {
    return hasFilledExpression(`${orderAlias}.job_completion_date`);
  }
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizeMilestoneExpression("completed_order.milestone")} = '${normalizeMilestoneName(
      milestone,
    )}'
  )`;
}

function effectiveOrderLiveExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and not ${hasFilledExpression(`${alias}.material_receipt_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderPaymentOpenExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and not ${hasFilledExpression(`${alias}.payment_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderDeliveryCompletedExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and ${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and ${hasFilledExpression(`${alias}.material_receipt_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderDeliveryOverdueExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and not (${effectiveOrderDeliveryCompletedExpression(alias)})
    and ${effectiveOrderDpDateExpression(alias)} < current_date`;
}

function effectiveOrderDeliveryPendingExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and not (${effectiveOrderDeliveryCompletedExpression(alias)})
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${alias}.so_date <= current_date
    and ${effectiveOrderDpDateExpression(alias)} >= current_date`;
}

function effectiveOrderJobCompletionWorkflowExpression(alias = "eso") {
  return `(not ${isYesExpression(`${alias}.file_ir`)}
    or lower(trim(coalesce(${alias}.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
}

function effectiveOrderJobCompletionLiveExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and ${effectiveOrderJobCompletionWorkflowExpression(alias)}
    and not ${effectiveOrderCompletedMilestoneExpression("Job Completion", alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} < current_date
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderJobCompletionCompletedExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and ${effectiveOrderJobCompletionWorkflowExpression(alias)}
    and ${effectiveOrderCompletedMilestoneExpression("Job Completion", alias)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderJobCompletionPeriodOverExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and ${effectiveOrderJobCompletionWorkflowExpression(alias)}
    and not ${effectiveOrderCompletedMilestoneExpression("Job Completion", alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} < current_date
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderDeliveryPeriodValidExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} >= current_date`;
}

function effectiveOrderDeliveryPeriodExpiredExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} < current_date`;
}

function effectiveOrderDeliveryPeriodExtendedExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${hasFilledExpression(`${alias}.revised_dp`)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} >= current_date`;
}

function effectiveOrderPaymentCompletedExpression(alias = "eso") {
  return `${hasFilledExpression(`${alias}.payment_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderPaymentPendingExpression(alias = "eso") {
  return `(
	      (
		        (not ${isYesExpression(`${alias}.file_ir`)}
		          or lower(trim(coalesce(${alias}.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
		        and ${effectiveOrderCompletedMilestoneExpression("Job Completion", alias)}
	      )
      or (
	        ${isYesExpression(`${alias}.file_ir`)}
	        and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
	        and ${hasFilledExpression(`${alias}.material_receipt_date`)}
      )
      or ${hasFilledExpression(`${alias}.bill_preparation_date`)}
      or ${hasFilledExpression(`${alias}.bill_sent_for_payment_date`)}
    )
    and not ${hasFilledExpression(`${alias}.payment_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function dashboardPaymentRowsSource(whereSql: string, extraConditions: string[] = []) {
  const stageCount = "jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))";
  const paymentApplicable = `(stage_row.stage is null
    or ${isYesExpression("so.stage_payment")}
    or (not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}))`;
  return `(select
      f.file_type,
      f.ir as file_ir,
      ${paymentApplicable} as payment_applicable,
      so.so_cancelled,
      coalesce(nullif(stage_row.stage ->> 'dpDate', '')::date, so.dp_date) as dp_date,
      coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, so.revised_dp) as revised_dp,
      case
        when stage_row.stage is not null then nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
        else so.material_receipt_date
      end as material_receipt_date,
      case
        when stage_row.stage is not null then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
        else so.job_completion_date
      end as job_completion_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'billPreparationDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.bill_preparation_date
        when stage_row.stage is not null then null::date
        else so.bill_preparation_date
      end as bill_preparation_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'billSentForPaymentDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.bill_sent_for_payment_date
        when stage_row.stage is not null then null::date
        else so.bill_sent_for_payment_date
      end as bill_sent_for_payment_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'paymentDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.payment_date
        when stage_row.stage is not null then null::date
        else so.payment_date
      end as payment_date,
	      case
	        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
	          then stage_row.stage ->> 'currentMilestone'
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.current_milestone
	        when stage_row.stage is not null then ''::text
	        else so.current_milestone
	      end as current_milestone,
	      case
	        when stage_row.stage is not null then coalesce(stage_row.stage -> 'completedMilestones', '[]'::jsonb)
	        else coalesce(so.completed_milestones, '[]'::jsonb)
	      end as completed_milestones
    from files f
    left join divisions d on d.id = f.division_id
    join supply_orders so on so.file_id = f.id
    left join lateral (
      select stage, ordinality
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stages(stage, ordinality)
      where ${isYesExpression("so.stage_delivery")}
      union all
      select null::jsonb as stage, 1::bigint as ordinality
      where not ${isYesExpression("so.stage_delivery")}
        or ${stageCount} = 0
	    ) stage_row on true
	    ${appendDashboardWhereClause(whereSql, extraConditions)})`;
}

function paymentRowReadyExpression(alias = "payment_row") {
  return `(
    ${hasFilledExpression(`${alias}.bill_preparation_date`)}
    or ${hasFilledExpression(`${alias}.bill_sent_for_payment_date`)}
	    or (
	      (not ${isYesExpression(`${alias}.file_ir`)}
	        or lower(trim(coalesce(${alias}.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
      and ${hasFilledExpression(`${alias}.job_completion_date`)}
	    )
    or (
	      ${isYesExpression(`${alias}.file_ir`)}
	      and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
	      and ${hasFilledExpression(`${alias}.material_receipt_date`)}
    )
  )`;
}

function paymentRowCompletedExpression(alias = "payment_row") {
  return `${alias}.payment_applicable
    and ${hasFilledExpression(`${alias}.payment_date`)}
    and not ${isYesExpression(`${alias}.so_cancelled`)}`;
}

function paymentRowPendingExpression(alias = "payment_row") {
  return `${alias}.payment_applicable
    and not ${hasFilledExpression(`${alias}.payment_date`)}
    and ${paymentRowReadyExpression(alias)}
    and not ${isYesExpression(`${alias}.so_cancelled`)}`;
}

function effectiveOrderIrPreparationPendingExpression(alias = "eso") {
  return `${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and ${effectiveOrderPlacedExpression(alias)}
    and (
      (
        ${isYesExpression(`${alias}.stage_delivery`)}
        and exists (
          select 1
          from jsonb_array_elements(coalesce(${alias}.stage_deliveries, '[]'::jsonb)) as ir_stage(stage)
          where coalesce(ir_stage.stage ->> 'materialReceiptDate', '') <> ''
            and coalesce(ir_stage.stage ->> 'irPreparationDate', '') = ''
        )
      )
      or (
        not ${isYesExpression(`${alias}.stage_delivery`)}
        and ${hasFilledExpression(`${alias}.material_receipt_date`)}
        and not ${hasFilledExpression(`${alias}.ir_preparation_date`)}
      )
    )
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderIrReceiptPendingExpression(alias = "eso") {
  return `${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and ${effectiveOrderPlacedExpression(alias)}
    and (
      (
        ${isYesExpression(`${alias}.stage_delivery`)}
        and exists (
          select 1
          from jsonb_array_elements(coalesce(${alias}.stage_deliveries, '[]'::jsonb)) as ir_stage(stage)
          where coalesce(ir_stage.stage ->> 'irPreparationDate', '') <> ''
            and coalesce(ir_stage.stage ->> 'irReceiptDate', '') = ''
        )
      )
      or (
        not ${isYesExpression(`${alias}.stage_delivery`)}
        and ${hasFilledExpression(`${alias}.ir_preparation_date`)}
        and not ${hasFilledExpression(`${alias}.ir_receipt_date`)}
      )
    )
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderIrCompletedExpression(alias = "eso") {
  return `${isYesExpression(`${alias}.file_ir`)}
    and lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
    and ${effectiveOrderPlacedExpression(alias)}
    and (
      (
        ${isYesExpression(`${alias}.stage_delivery`)}
        and exists (
          select 1
          from jsonb_array_elements(coalesce(${alias}.stage_deliveries, '[]'::jsonb)) as ir_stage(stage)
          where coalesce(ir_stage.stage ->> 'irReceiptDate', '') <> ''
        )
      )
      or (
        not ${isYesExpression(`${alias}.stage_delivery`)}
        and ${hasFilledExpression(`${alias}.ir_receipt_date`)}
      )
    )
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderCountFilter(condition: string) {
  return `(select count(*) from effective_supply_orders eso where ${condition})::integer`;
}

function normalizeMilestoneExpression(column: string) {
  return `regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]+', '', 'g')`;
}

function normalizeMilestoneName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isPhysicalDeliveryWorkflow(file: Pick<FileRecord, "fileType" | "fileTypeGroup" | "ir">) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function isJobCompletionWorkflow(file: Pick<FileRecord, "fileType" | "fileTypeGroup" | "ir">) {
  return !isPhysicalDeliveryWorkflow(file);
}

function isJobCompletionDone(order: Pick<SupplyOrderDetail, "jobCompletionDate">) {
  return hasFilledString(order.jobCompletionDate);
}

function isBgStatusKey(value: string) {
  return ["psb", "pwb", "psbpwb"].includes(normalizeMilestoneName(value));
}

function bgCategoryExpression(orderAlias: string, category: string) {
  const normalized = normalizeMilestoneName(category);
  const fileBgExpression = orderAlias === "so" ? "f.bg" : `${orderAlias}.file_bg`;
  if (normalized === "psb") {
    return `${isYesExpression(`${orderAlias}.psb_applicable`)}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`;
  }
  if (normalized === "pwb") {
    return `${isYesExpression(fileBgExpression)}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) in ('PWB', 'PSB and PWB separately')`;
  }
  if (normalized === "psbpwb") {
    return `${isYesExpression(fileBgExpression)}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) = 'PSB+PWB'`;
  }
  return "false";
}

function bgReceivedColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_received_date";
  if (normalized === "pwb") return "pwb_bg_received_date";
  if (normalized === "psbpwb") return "combined_bg_received_date";
  return "psb_bg_received_date";
}

function bgValidityColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_validity_date";
  if (normalized === "pwb") return "pwb_bg_validity_date";
  if (normalized === "psbpwb") return "combined_bg_validity_date";
  return "psb_bg_validity_date";
}

function bgReturnColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_return_date";
  if (normalized === "pwb") return "pwb_bg_return_date";
  if (normalized === "psbpwb") return "combined_bg_return_date";
  return "psb_bg_return_date";
}

function fileClosedExpression() {
  return `exists (
    select 1 from file_completed_milestones completed_closed
    where completed_closed.file_id = f.id
      and ${normalizeMilestoneExpression("completed_closed.milestone")} = '${normalizeMilestoneName(
        fileClosedMilestone,
      )}'
  )`;
}

function financialSanctionCompleteExpression() {
  return `not ${isCancelledExpression()} and ${supplyOrderExists(
    `not ${isYesExpression("so.so_cancelled")}
     and ${hasFilledExpression("so.financial_sanction_date")}`,
  )}`;
}

function biddingApplicableExpression() {
  return `upper(trim(coalesce(f.mode, ''))) <> 'LPC'
    and lower(trim(coalesce(f.file_type, ''))) not in ('cars', 'capsi')
    and not (${isYesExpression("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = 'comparison')`;
}

function statusAppliesExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  if (milestone.key === "bidding") return biddingApplicableExpression();
  if (milestone.key === "refloatPostTcec")
    return `${isYesExpression("f.refloat")} and ${isYesExpression("f.tcec")} and ${isYesExpression("f.bidding_stage_over")}`;
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesExpression(milestone.appliesColumn)
    : "true";
}

function statusCompleteExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete) {
    return isYesExpression(milestone.currentColumn);
  }
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    if (isBgStatusKey(milestone.key)) {
      const receivedColumn = bgReceivedColumn(milestone.key);
      return supplyOrderChildExpression(
        `${bgCategoryExpression("so", milestone.key)}
          and (${hasFilledExpression(`so.${receivedColumn}`)}
            or ${completedOrderMilestoneExpression("so", milestone.label)})`,
        "false",
      );
    }
    return supplyOrderChildExpression(
      hasFilledExpression(`so.${milestone.supplyOrderDate}`),
      hasFilledExpression(`f.${milestone.supplyOrderDate}`),
    );
  }
  return "currentColumn" in milestone && milestone.currentColumn
    ? hasFilledExpression(milestone.currentColumn)
    : "false";
}

function statusReviewedExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  return "reviewedColumn" in milestone && milestone.reviewedColumn
    ? hasFilledExpression(milestone.reviewedColumn)
    : "false";
}

function statusActiveExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  if (milestone.key === "refloatBidding") {
    return `not ${isCancelledExpression()} and ${isYesExpression("f.refloat")} and not ${isYesExpression("f.bidding_stage_over")}`;
  }
  if (milestone.key === "refloatPostTcec") {
    return `not ${isCancelledExpression()}
      and ${isYesExpression("f.refloat")}
      and ${isYesExpression("f.tcec")}
      and ${isYesExpression("f.bidding_stage_over")}
      and not ${hasFilledExpression("f.refloat_post_tcec_minutes_date")}`;
  }
  if (isBgStatusKey(milestone.key)) {
    const normalized = normalizeMilestoneName(milestone.key);
    return `not ${isCancelledExpression()} and ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and ${bgCategoryExpression("so", milestone.key)}
       and (
         (${normalizeMilestoneExpression("so.current_milestone")} = '${normalized}')
	         or ('${normalized}' in ('psb', 'psbpwb')
	           and ${hasFilledExpression("so.financial_sanction_date")})
         or ('${normalized}' = 'pwb'
           and (
             (${isYesExpression("f.ir")} and ${hasFilledExpression("so.material_receipt_date")})
             or (not ${isYesExpression("f.ir")} and ${completedOrderMilestoneExpression(
               "so",
               "Job Completion",
             )})
           ))
       )`,
    )}`;
  }
  const aliases =
    "aliases" in milestone && milestone.aliases ? milestone.aliases : [milestone.label];
  const normalizedAliases = aliases.map((alias) => `'${normalizeMilestoneName(alias)}'`).join(", ");
  return `not ${isCancelledExpression()}
    and ${normalizeMilestoneExpression("f.current_milestone")} in (${normalizedAliases})`;
}

function previousApplicableCompleteExpression(index: number) {
  const previous = statusMilestoneDefinitions
    .slice(0, index)
    .filter((milestone) => milestone.key !== "highValue")
    .reverse();
  if (!previous.length) return hasFilledExpression("f.received_date");
  return `case
    ${previous
      .map(
        (milestone) =>
          `when ${statusAppliesExpression(milestone)} then ${statusCompleteExpression(milestone)}`,
      )
      .join("\n    ")}
    else ${hasFilledExpression("f.received_date")}
  end`;
}

function statusPreviousStageExpression(
  milestone: (typeof statusMilestoneDefinitions)[number],
  index: number,
) {
  if (milestone.key === "refloatBidding") return "false";
  if (milestone.key === "refloatPostTcec") {
    return `${isYesExpression("f.refloat")} and not ${isYesExpression("f.bidding_stage_over")}`;
  }
  const applies = statusAppliesExpression(milestone);
  const previousComplete = previousApplicableCompleteExpression(index);
  const complete = statusCompleteExpression(milestone);
  const active = statusActiveExpression(milestone);
  const reviewed = statusReviewedExpression(milestone);
  return `${applies}
    and (${previousComplete})
    and not (${complete})
    and not (${active})
    and not (${reviewed})`;
}

function financialSanctionPreviousStageExpression() {
  return `not ${isCancelledExpression()}
    and not (${financialSanctionCompleteExpression()})
    and not (${financialSanctionReachedExpression()})
    and (
      (not ${isYesExpression("f.tcec")}
        and (
          (${biddingApplicableExpression()}
            and ${normalizeMilestoneExpression("f.current_milestone")} = 'bidding'
            and not ${isYesExpression("f.bidding_stage_over")})
          or (not ${biddingApplicableExpression()}
            and ${normalizeMilestoneExpression("f.current_milestone")} = 'cfa'
            and not ${hasFilledExpression("f.cfa_date")})
        ))
      or (${isYesExpression("f.tcec")}
        and ${normalizeMilestoneExpression("f.current_milestone")} = 'cnc'
        and not ${hasFilledExpression("f.cnc_approval_date")})
    )`;
}

function financialSanctionReachedExpression() {
  return `not ${isCancelledExpression()}
    and ((${biddingApplicableExpression()} and ${isYesExpression("f.bidding_stage_over")})
      or (not ${biddingApplicableExpression()} and ${hasFilledExpression("f.cfa_date")}))
    and (not ${isYesExpression("f.tcec")} or ${hasFilledExpression("f.cnc_approval_date")})`;
}

function financialSanctionPendingExpression(orderAlias = "eso") {
  return `${financialSanctionReachedExpression()}
    and not ${effectiveOrderCancelledExpression(orderAlias)}
    and not ${hasFilledExpression(`${orderAlias}.financial_sanction_date`)}`;
}

async function loadFinanceTotals({
  whereSql,
  values,
  activeDivision,
  dashboardDivisions,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
  dashboardDivisions: Division[];
}): Promise<FinanceTotals> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  extraConditions.push(`not ${isCancelledExpression()}`);
  const cancelled = isCancelledExpression();
  const valueCapital = inrAmountExpression("f.value_capital");
  const valueRevenue = inrAmountExpression("f.value_revenue");
  const committedCapital = committedValueExpression("f.so_value_capital", "so_value_capital");
  const committedRevenue = committedValueExpression("f.so_value_revenue", "so_value_revenue");
  const paidCapital = paymentValueExpression("actual_payment_capital", "actualPaymentCapital");
  const paidRevenue = paymentValueExpression("actual_payment_revenue", "actualPaymentRevenue");
  const result = await pool.query<Record<string, string | number>>(
    `select
       coalesce(sum(case
         when ${cancelled} then 0
         when ${hasFilledExpression("f.imms")} and ${committedCapital} <= 0 then ${valueCapital}
         else 0
       end), 0) as booked_capital,
       coalesce(sum(case
         when ${cancelled} then 0
         when ${hasFilledExpression("f.imms")} and ${committedRevenue} <= 0 then ${valueRevenue}
         else 0
       end), 0) as booked_revenue,
       coalesce(sum(case
         when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${valueCapital}
         else 0
       end), 0) as projected_capital,
       coalesce(sum(case
         when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${valueRevenue}
         else 0
       end), 0) as projected_revenue,
       coalesce(sum(${committedCapital}), 0) as spent_capital,
       coalesce(sum(${committedRevenue}), 0) as spent_revenue,
      coalesce(sum(${paidCapital}), 0) as paid_capital,
       coalesce(sum(${paidRevenue}), 0) as paid_revenue,
       coalesce(sum(coalesce((
         select sum(
           ${inrAmountExpression("coalesce(nullif(so_advance.advance_payment_detail ->> 'actualPaymentCapital', ''), nullif(so_advance.advance_payment_detail ->> 'stageAmountCapital', ''))")}
         )
         from supply_orders so_advance
         where so_advance.file_id = f.id
           and ${isYesExpression("so_advance.advance_payment")}
           and not ${isYesExpression("so_advance.so_cancelled")}
       ), 0)), 0) as advance_capital,
       coalesce(sum(coalesce((
         select sum(
           ${inrAmountExpression("coalesce(nullif(so_advance.advance_payment_detail ->> 'actualPaymentRevenue', ''), nullif(so_advance.advance_payment_detail ->> 'stageAmountRevenue', ''))")}
         )
         from supply_orders so_advance
         where so_advance.file_id = f.id
           and ${isYesExpression("so_advance.advance_payment")}
           and not ${isYesExpression("so_advance.so_cancelled")}
       ), 0)), 0) as advance_revenue
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readAmount = (key: string) => Number(row[key] ?? 0);
  return {
    allocatedCapital: dashboardDivisions.reduce(
      (sum, division) =>
        sum + (Number(String(division.allocatedCapital ?? "").replace(/,/g, "")) || 0),
      0,
    ),
    allocatedRevenue: dashboardDivisions.reduce(
      (sum, division) =>
        sum + (Number(String(division.allocatedRevenue ?? "").replace(/,/g, "")) || 0),
      0,
    ),
    bookedCapital: readAmount("booked_capital"),
    bookedRevenue: readAmount("booked_revenue"),
    projectedCapital: readAmount("projected_capital"),
    projectedRevenue: readAmount("projected_revenue"),
    spentCapital: readAmount("spent_capital"),
    spentRevenue: readAmount("spent_revenue"),
    paidCapital: readAmount("paid_capital"),
    paidRevenue: readAmount("paid_revenue"),
    advanceCapital: readAmount("advance_capital"),
    advanceRevenue: readAmount("advance_revenue"),
  };
}

function getPercent(value: number, total: number) {
  if (total <= 0) return undefined;
  return (value / total) * 100;
}

function roundContributionPercent(value: number | undefined) {
  if (value === undefined) return 0;
  return Number(value.toFixed(1));
}

function finalizeThresholdAnalyticsRows(rows: ThresholdAnalyticsRow[]) {
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalCapitalCount = rows.reduce((sum, row) => sum + row.capitalCount, 0);
  const totalRevenueCount = rows.reduce((sum, row) => sum + row.revenueCount, 0);
  const totalCapital = rows.reduce((sum, row) => sum + row.capital, 0);
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  return rows.map((row) => ({
    ...row,
    countContribution: roundContributionPercent(getPercent(row.count, totalCount)),
    capitalCountContribution: roundContributionPercent(
      getPercent(row.capitalCount, totalCapitalCount),
    ),
    revenueCountContribution: roundContributionPercent(
      getPercent(row.revenueCount, totalRevenueCount),
    ),
    capitalContribution: roundContributionPercent(getPercent(row.capital, totalCapital)),
    revenueContribution: roundContributionPercent(getPercent(row.revenue, totalRevenue)),
    valueContribution: roundContributionPercent(getPercent(row.value, totalValue)),
  }));
}

function getFinancePercents(financeTotals: FinanceTotals) {
  return {
    capitalBooked: getPercent(financeTotals.bookedCapital, financeTotals.allocatedCapital),
    revenueBooked: getPercent(financeTotals.bookedRevenue, financeTotals.allocatedRevenue),
    capitalProjected: getPercent(financeTotals.projectedCapital, financeTotals.allocatedCapital),
    revenueProjected: getPercent(financeTotals.projectedRevenue, financeTotals.allocatedRevenue),
    capitalSpent: getPercent(financeTotals.spentCapital, financeTotals.allocatedCapital),
    revenueSpent: getPercent(financeTotals.spentRevenue, financeTotals.allocatedRevenue),
  };
}

function roundedFinanceTotals(totals: FinanceTotals): FinanceTotals {
  return {
    allocatedCapital: totals.allocatedCapital,
    allocatedRevenue: totals.allocatedRevenue,
    bookedCapital: Number(totals.bookedCapital.toFixed(6)),
    bookedRevenue: Number(totals.bookedRevenue.toFixed(6)),
    projectedCapital: Number(totals.projectedCapital.toFixed(6)),
    projectedRevenue: Number(totals.projectedRevenue.toFixed(6)),
    spentCapital: Number(totals.spentCapital.toFixed(6)),
    spentRevenue: Number(totals.spentRevenue.toFixed(6)),
    paidCapital: Number(totals.paidCapital.toFixed(6)),
    paidRevenue: Number(totals.paidRevenue.toFixed(6)),
    advanceCapital: Number(totals.advanceCapital.toFixed(6)),
    advanceRevenue: Number(totals.advanceRevenue.toFixed(6)),
  };
}

function analyticsDivisionExtraCondition(values: unknown[], divisionName: string) {
  if (divisionName === "all") return undefined;
  const placeholder = addValue(values, divisionName.toLowerCase());
  return `lower(coalesce(d.name, '')) = ${placeholder}::text`;
}

function analyticsNameExpression(column: string, fallback: string) {
  return `coalesce(nullif(trim(coalesce(${column}, '')), ''), '${fallback}')`;
}

function childSupplyOrderValueSumExpression(column: "so_value_capital" | "so_value_revenue") {
  return `coalesce((
    select sum(${inrAmountExpression(`so_value.${column}`)})
    from supply_orders so_value
    where so_value.file_id = f.id and not ${isYesExpression("so_value.so_cancelled")}
  ), 0)`;
}

function committedValueExpression(
  _fileColumn: "f.so_value_capital" | "f.so_value_revenue",
  supplyOrderColumn: "so_value_capital" | "so_value_revenue",
) {
  return `case
    when ${isSoCancelledExpression()} then 0
    else ${childSupplyOrderValueSumExpression(supplyOrderColumn)}
  end`;
}

function paymentValueExpression(
  supplyOrderColumn: "actual_payment_capital" | "actual_payment_revenue",
  jsonColumn: "actualPaymentCapital" | "actualPaymentRevenue",
) {
  const directValue = inrAmountExpression(`so_payment.${supplyOrderColumn}`);
  const stageValue = inrAmountExpression(
    `nullif(stage_payment.stage ->> '${jsonColumn}', '')::numeric`,
  );
  const advanceValue = inrAmountExpression(
    `nullif(so_payment.advance_payment_detail ->> '${jsonColumn}', '')::numeric`,
  );
  return `coalesce((
    select sum(
      case
        when ${isYesExpression("so_payment.so_cancelled")}
        then 0
        else
          case
            when ${isYesExpression("so_payment.stage_delivery")}
              and ${isYesExpression("so_payment.stage_payment")}
            then coalesce((
              select sum(${stageValue})
              from jsonb_array_elements(so_payment.stage_deliveries) as stage_payment(stage)
            ), 0)
            else ${directValue}
          end
          + case
            when ${isYesExpression("so_payment.stage_delivery")}
              and ${isYesExpression("so_payment.stage_payment")}
              and ${isYesExpression("so_payment.advance_payment")}
            then ${advanceValue}
            else 0
          end
      end
    )
    from supply_orders so_payment
    where so_payment.file_id = f.id
  ), 0)`;
}

function earliestSupplyOrderDateExpression(column: string) {
  return `case
    when ${supplyOrderRowExists()} then (
      select min(so_date_value.${column})
      from supply_orders so_date_value
      where so_date_value.file_id = f.id and so_date_value.${column} is not null
    )
    else f.${column}
  end`;
}

function averageDaysExpression(startDate: string, endDate: string) {
  return `round(avg((${endDate}) - (${startDate})))::integer`;
}

function clearingDaysExpression(startDate: string, endDate: string) {
  return `((${endDate}) - (${startDate}))`;
}

function clearingStatsSelect(
  startDate: string,
  endDate: string,
  cumulativeStartDate = "f.received_date",
) {
  const days = clearingDaysExpression(startDate, endDate);
  const cumulativeDays = clearingDaysExpression(cumulativeStartDate, endDate);
  return `${averageDaysExpression(startDate, endDate)} as "averageDays",
              coalesce(round(avg(${cumulativeDays})), 0)::integer as "cumulativeDays",
              coalesce(min(${days}), 0)::integer as "minDays",
              coalesce(max(${days}), 0)::integer as "maxDays",
              coalesce(round(percentile_cont(0.5) within group (order by ${days})), 0)::integer as "medianDays"`;
}

function dateDiffCondition(startDate: string, endDate: string) {
  return `(${startDate}) is not null and (${endDate}) is not null and ((${endDate}) - (${startDate})) >= 0`;
}

function getPreviousApplicableMilestoneCompletionSql(
  definitions: Array<{ end: string; applies?: string }>,
  index: number,
  currentEnd: string,
) {
  if (index <= 0) return "f.received_date";
  const previousDates = definitions.slice(0, index).map((definition) => {
    const applies = definition.applies ?? "true";
    return `case when ${applies} and (${definition.end}) is not null and (${definition.end}) <= (${currentEnd}) then ${definition.end} else null end`;
  });
  return `greatest(f.received_date, ${previousDates.join(", ")})`;
}

function formatThresholdAppliesTo(value: ValueThresholdLevel["appliesTo"]) {
  if (value === "capital") return "Capital";
  if (value === "revenue") return "Revenue";
  return "Both";
}

function formatThresholdRange(level: ValueThresholdLevel) {
  const min = Number(
    String(level.minValue ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  const max = Number(
    String(level.maxValue ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  const hasMin = Number.isFinite(min) && String(level.minValue ?? "").trim() !== "";
  const hasMax = Number.isFinite(max) && String(level.maxValue ?? "").trim() !== "";
  if (hasMin && hasMax) return `${formatLakhRangeAmount(min)}-${formatLakhRangeAmount(max)} L`;
  if (hasMin) return `${formatLakhRangeAmount(min)} L+`;
  if (hasMax) return `0-${formatLakhRangeAmount(max)} L`;
  return "Any value";
}

function formatLakhRangeAmount(value: number) {
  const lakhs = value / 100000;
  return Number.isInteger(lakhs)
    ? String(lakhs)
    : lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function roundDivisionValueRows(
  rows: Map<
    string,
    Omit<
      DivisionValueAnalyticsRow,
      "name" | "allocatedTotal" | "intendedTotal" | "bookedTotal" | "committedTotal"
    >
  >,
) {
  return Array.from(rows.entries())
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

async function loadAnalyticsSqlSlice({
  whereSql,
  values,
  divisionName,
  divisions,
  valueThresholdLevels,
}: {
  whereSql: string;
  values: unknown[];
  divisionName: string;
  divisions: Division[];
  valueThresholdLevels: ValueThresholdLevel[];
}): Promise<AnalyticsSqlSlice> {
  const fileRankingValues = [...values];
  const fileRankingConditions: string[] = [`not ${isCancelledExpression()}`];
  const fileRankingDivision = analyticsDivisionExtraCondition(fileRankingValues, divisionName);
  if (fileRankingDivision) fileRankingConditions.push(fileRankingDivision);

  const divisionNameSql = analyticsNameExpression("d.name", "Unassigned");
  const fileRankingResult = await pool.query<{ name: string; count: number }>(
    `select ${divisionNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const indentorNameSql = analyticsNameExpression("f.indentor", "Unassigned indentor");
  const indentorFileResult = await pool.query<{ name: string; count: number }>(
    `select ${indentorNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const demandTotal = `${inrAmountExpression("f.value_capital")} + ${inrAmountExpression("f.value_revenue")}`;
  const indentorValueResult = await pool.query<{ name: string; value: string | number }>(
    `select ${indentorNameSql} as name, round(coalesce(sum(${demandTotal}), 0))::integer as value
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by value desc`,
    fileRankingValues,
  );

  const modeNameSql = analyticsNameExpression("upper(trim(coalesce(f.mode, '')))", "Unassigned");
  const biddingModeResult = await pool.query<{ name: string; count: number }>(
    `select ${modeNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const firstSoDate = earliestSupplyOrderDateExpression("so_date");
  const turnaroundResult = await pool.query<AverageDaysAnalyticsRow>(
    `select ${divisionNameSql} as name,
            ${averageDaysExpression("f.received_date", firstSoDate)} as "averageDays",
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       dateDiffCondition("f.received_date", firstSoDate),
     ])}
     group by 1
     order by "averageDays" desc`,
    fileRankingValues,
  );

  const milestoneClearingDefinitions: Array<{
    name: string;
    end: string;
    applies?: string;
  }> = [
    { name: "Scrutiny", end: "f.scrutiny_completion_date" },
    {
      name: "High Value",
      end: "f.high_value_minutes_date",
      applies: isYesExpression("f.high_value"),
    },
    { name: "Pre-TCEC", end: "f.pre_tcec_minutes_date", applies: isYesExpression("f.tcec") },
    {
      name: "AD",
      end: "f.ad_vetting_date",
      applies: isYesExpression("f.ad"),
    },
    { name: "R&QA", end: "f.rqa_approval_date", applies: isYesExpression("f.rqa") },
    { name: "Controlling", end: "f.imms_date" },
    { name: "IFA", end: "f.ifa_final_date", applies: isYesExpression("f.ifa") },
    { name: "CFA", end: "f.cfa_date" },
    {
      name: "Bidding",
      end: `case when ${isYesExpression("f.refloat")} then f.refloat_bid_opening_date else f.bid_opening_date end`,
      applies: biddingApplicableExpression(),
    },
    {
      name: "Post-TCEC",
      end: `case when ${isYesExpression("f.refloat")} then f.refloat_post_tcec_minutes_date else f.post_tcec_minutes_date end`,
      applies: isYesExpression("f.tcec"),
    },
    { name: "CNC", end: "f.cnc_approval_date", applies: isYesExpression("f.tcec") },
  ];
  const milestoneSelects = milestoneClearingDefinitions.map((definition, index) => {
    const start = getPreviousApplicableMilestoneCompletionSql(
      milestoneClearingDefinitions,
      index,
      definition.end,
    );
    return `select ${index} as sort_order,
	              '${definition.name}' as name,
	              ${clearingStatsSelect(start, definition.end)},
              count(*)::integer as "sampleSize"
       from files f
       left join divisions d on d.id = f.division_id
	       ${appendDashboardWhereClause(whereSql, [
           ...fileRankingConditions,
           definition.applies ?? "true",
           dateDiffCondition(start, definition.end),
         ])}`;
  });
  const paymentDpDate = `coalesce(
    nullif(payment_stage.stage ->> 'revisedDp', '')::date,
    nullif(payment_stage.stage ->> 'dpDate', '')::date,
    so.revised_dp,
    so.dp_date
  )`;
  const paymentMaterialReceiptDate = `coalesce(
    nullif(payment_stage.stage ->> 'materialReceiptDate', '')::date,
    so.material_receipt_date
  )`;
  const paymentJobCompletionDate = `coalesce(
    nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date,
    so.job_completion_date
  )`;
  const paymentIrPreparationDate = `coalesce(
    nullif(payment_stage.stage ->> 'irPreparationDate', '')::date,
    so.ir_preparation_date
  )`;
  const paymentIrReceiptDate = `coalesce(
    nullif(payment_stage.stage ->> 'irReceiptDate', '')::date,
    so.ir_receipt_date
  )`;
  const paymentBillPreparationDate = `coalesce(
    nullif(payment_stage.stage ->> 'billPreparationDate', '')::date,
    so.bill_preparation_date
  )`;
  const paymentBillSentDate = `coalesce(
    nullif(payment_stage.stage ->> 'billSentForPaymentDate', '')::date,
    so.bill_sent_for_payment_date
  )`;
  const paymentDate = `coalesce(
    nullif(payment_stage.stage ->> 'paymentDate', '')::date,
    so.payment_date
  )`;
  const paymentJobCompletionDone = `coalesce(
    nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date,
    so.job_completion_date
  ) is not null`;
  const paymentContractFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
  const paymentGoodsServicesIrNo = `(not ${isYesExpression("f.ir")} and not ${paymentContractFileType})`;
  const paymentClearingStart = `case
    when ${deliveryInspectionApplicableExpression()} then coalesce(
      nullif(payment_stage.stage ->> 'materialReceiptDate', '')::date,
      so.material_receipt_date
    )
    when ${paymentContractFileType} and ${paymentDpDate} is not null
    then (${paymentDpDate} + 1)
    when ${paymentGoodsServicesIrNo} and ${paymentJobCompletionDone}
    then ${paymentJobCompletionDate}
    else null
  end`;
  const irClearingApplicable = `${deliveryInspectionApplicableExpression()} and ${isYesExpression("f.ir")}`;
  const billPreparationStart = `case
    when ${irClearingApplicable} then ${paymentIrReceiptDate}
    else ${paymentClearingStart}
  end`;
  const finalPaymentStageJoin = `left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
       on not (${isYesExpression("so.stage_delivery")} and not ${isYesExpression("so.stage_payment")})
         and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const finalPaymentBaseWhere = [
    ...fileRankingConditions,
    `not ${isYesExpression("so.so_cancelled")}`,
    `not ${isYesExpression("so.shortclosure")}`,
  ];
  const returnedBillReturnedDate = `nullif(return_cycle.cycle ->> 'returnedDate', '')::date`;
  const returnedBillResubmittedDate = `nullif(return_cycle.cycle ->> 'resubmittedDate', '')::date`;
  const supplementaryBillReturnedDate = `nullif(supplementary_return_cycle.cycle ->> 'returnedDate', '')::date`;
  const supplementaryBillResubmittedDate = `nullif(supplementary_return_cycle.cycle ->> 'resubmittedDate', '')::date`;
  const supplyOrderClearingStart = getPreviousApplicableMilestoneCompletionSql(
    milestoneClearingDefinitions,
    milestoneClearingDefinitions.length,
    "so.so_date",
  );
  milestoneSelects.push(
    `select ${milestoneClearingDefinitions.length} as sort_order,
            'Supply Order' as name,
            ${clearingStatsSelect(supplyOrderClearingStart, "so.so_date")},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       `not ${isYesExpression("so.so_cancelled")}`,
       dateDiffCondition(supplyOrderClearingStart, "so.so_date"),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 1} as sort_order,
            'IR Preparation' as name,
            ${clearingStatsSelect(paymentMaterialReceiptDate, paymentIrPreparationDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       irClearingApplicable,
       dateDiffCondition(paymentMaterialReceiptDate, paymentIrPreparationDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 2} as sort_order,
            'IR Receipt' as name,
            ${clearingStatsSelect(paymentIrPreparationDate, paymentIrReceiptDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       irClearingApplicable,
       dateDiffCondition(paymentIrPreparationDate, paymentIrReceiptDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 3} as sort_order,
            'Bill preparation' as name,
            ${clearingStatsSelect(billPreparationStart, paymentBillPreparationDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       dateDiffCondition(billPreparationStart, paymentBillPreparationDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 4} as sort_order,
            'Bill sent for payment' as name,
            ${clearingStatsSelect(paymentBillPreparationDate, paymentBillSentDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       dateDiffCondition(paymentBillPreparationDate, paymentBillSentDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 5} as sort_order,
            'Bill returned for correction' as name,
            ${clearingStatsSelect(returnedBillReturnedDate, returnedBillResubmittedDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     join lateral jsonb_array_elements(
       coalesce(payment_stage.stage -> 'billReturnCycles', so.bill_return_cycles, '[]'::jsonb)
     ) as return_cycle(cycle) on true
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       dateDiffCondition(returnedBillReturnedDate, returnedBillResubmittedDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 6} as sort_order,
            'Supplementary bill returned for correction' as name,
            ${clearingStatsSelect(supplementaryBillReturnedDate, supplementaryBillResubmittedDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     join lateral jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill) on true
     join lateral jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as supplementary_return_cycle(cycle) on true
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       dateDiffCondition(supplementaryBillReturnedDate, supplementaryBillResubmittedDate),
     ])}`,
    `select ${milestoneClearingDefinitions.length + 7} as sort_order,
            'Payment' as name,
            ${clearingStatsSelect(paymentBillSentDate, paymentDate)},
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${finalPaymentStageJoin}
     ${appendDashboardWhereClause(whereSql, [
       ...finalPaymentBaseWhere,
       dateDiffCondition(paymentBillSentDate, paymentDate),
     ])}`,
  );
  const milestoneResult = await pool.query<AverageDaysAnalyticsRow & { sort_order: number }>(
    `${milestoneSelects.join("\nunion all\n")}
     order by sort_order`,
    fileRankingValues,
  );

  const monthlyValues = [...fileRankingValues];
  const monthlyResult = await pool.query<{ name: string; count: number }>(
    `select to_char(f.received_date, 'YYYY-MM') as name,
            count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       "f.received_date is not null",
     ])}
     group by 1
     order by name desc
     limit 12`,
    monthlyValues,
  );

  const monthWiseSupplyOrderValues = [...fileRankingValues];
  const monthWiseSupplyOrderResult = await pool.query<MonthWiseSupplyOrderAnalyticsRow>(
    `select to_char(so.so_date, 'YYYY-MM') as name,
            to_char(so.so_date, 'YYYY-MM') as "monthKey",
            count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       "so.so_date is not null",
       `not ${isYesExpression("so.so_cancelled")}`,
     ])}
     group by 1, 2
     order by name`,
    monthWiseSupplyOrderValues,
  );

  const monthWiseDeliveryScheduleValues = [...fileRankingValues];
  const monthWiseDeliveryScheduleResult = await pool.query<MonthWiseDeliveryScheduleAnalyticsRow>(
    `with effective_delivery_rows as (
       select
         coalesce(
           nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
           nullif(stage_delivery.stage ->> 'dpDate', '')::date,
           so.revised_dp,
           so.dp_date
         ) as dp_date,
         case
           when stage_delivery.stage is not null then (
	             (
		               ${isYesExpression("f.ir")}
		               and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
		               and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> ''
		             )
			             or (
			               (not ${isYesExpression("f.ir")}
			                 or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			               and coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''
		             )
	             or exists (
               select 1
               from jsonb_array_elements_text(
                 coalesce(stage_delivery.stage -> 'completedMilestones', '[]'::jsonb)
               ) as completed_stage(milestone)
               where ${normalizeMilestoneExpression("completed_stage.milestone")} = 'delivery'
             )
           )
           else (
	             (
		               ${isYesExpression("f.ir")}
		               and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
		               and ${hasFilledExpression("so.material_receipt_date")}
		             )
			             or (
			               (not ${isYesExpression("f.ir")}
			                 or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			               and ${hasFilledExpression("so.job_completion_date")}
		             )
	             or ${completedOrderMilestoneExpression("so", "Delivery")}
           )
         end as fructified
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
         on ${isYesExpression("so.stage_delivery")}
           and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${isYesExpression("so.so_cancelled")}`,
       ])}
     )
     select to_char(dp_date, 'YYYY-MM') as name,
            to_char(dp_date, 'YYYY-MM') as "monthKey",
            count(*)::integer as "grossCount",
            count(*) filter (where not fructified)::integer as "netCount"
     from effective_delivery_rows
     where dp_date is not null
     group by 1, 2
     order by name`,
    monthWiseDeliveryScheduleValues,
  );

  const firmValues = [...fileRankingValues];
  const firmResult = await pool.query<{ name: string; value: string | number }>(
    `with effective_supply_orders as (
       select
         f.id as file_id,
         ${analyticsNameExpression("so.firm", "Unassigned firm")} as name,
         case
           when ${isYesExpression("so.stage_delivery")}
             and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
           then
             ${inrAmountExpression("nullif(stage_order.stage ->> 'stageAmountCapital', '')::numeric")}
             + ${inrAmountExpression("nullif(stage_order.stage ->> 'stageAmountRevenue', '')::numeric")}
           else ${inrAmountExpression("so.so_value_capital")} + ${inrAmountExpression("so.so_value_revenue")}
         end as value
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_order(stage)
         on ${isYesExpression("so.stage_delivery")}
           and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${isYesExpression("so.so_cancelled")}`,
       ])}
       union all
       select
         f.id as file_id,
         ${analyticsNameExpression("f.firm", "Unassigned firm")} as name,
         ${inrAmountExpression("f.so_value_capital")} + ${inrAmountExpression("f.so_value_revenue")} as value
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${supplyOrderRowExists()}`,
       ])}
     )
     select name, round(sum(value))::integer as value
     from effective_supply_orders
     where value > 0
     group by 1
     order by value desc`,
    firmValues,
  );

  const riskResult = await pool.query<CountAnalyticsRow>(
    `with effective_risk_rows as (
       select
         ${divisionNameSql} as name,
         coalesce(stage_risk.stage ->> 'deliveryPeriodStartDate', so.so_date::text) as delivery_period_start_date,
         coalesce(stage_risk.stage ->> 'dpDate', so.dp_date::text) as dp_date,
         coalesce(stage_risk.stage ->> 'revisedDp', so.revised_dp::text) as revised_dp,
         coalesce(stage_risk.stage ->> 'materialReceiptDate', so.material_receipt_date::text) as material_receipt_date,
         so.ld,
         so.so_cancelled,
         f.demand_cancelled,
         f.file_type
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_risk(stage)
         on ${isYesExpression("so.stage_delivery")}
           and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
       ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
       union all
       select
         ${divisionNameSql} as name,
         f.so_date::text as delivery_period_start_date,
         f.dp_date::text as dp_date,
         f.revised_dp::text as revised_dp,
         f.material_receipt_date::text as material_receipt_date,
         f.ld,
         f.so_cancelled,
         f.demand_cancelled,
         f.file_type
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [...fileRankingConditions, `not ${supplyOrderRowExists()}`])}
     )
     select name, count(*)::integer as count
     from effective_risk_rows
     where ${isYesExpression("demand_cancelled")}
       or ${isYesExpression("ld")}
       or ${isYesExpression("so_cancelled")}
       or (
         lower(trim(coalesce(file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
         and coalesce(material_receipt_date, '') = ''
         and nullif(delivery_period_start_date, '')::date <= current_date
	         and coalesce(nullif(revised_dp, '')::date, nullif(dp_date, '')::date) is not null
	         and coalesce(nullif(revised_dp, '')::date, nullif(dp_date, '')::date) >= current_date
	       )
	       or (
	         coalesce(material_receipt_date, '') = ''
	         and coalesce(nullif(revised_dp, '')::date, nullif(dp_date, '')::date) is not null
	         and coalesce(nullif(revised_dp, '')::date, nullif(dp_date, '')::date) < current_date
	       )
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const paymentPendingResult = await pool.query<CountAnalyticsRow>(
    `with effective_payment_rows as (
       select
         ${divisionNameSql} as name,
         f.file_type,
         f.ir as file_ir,
         coalesce(stage_payment.stage ->> 'materialReceiptDate', so.material_receipt_date::text) as material_receipt_date,
         coalesce(stage_payment.stage ->> 'jobCompletionDate', so.job_completion_date::text) as job_completion_date,
         coalesce(stage_payment.stage ->> 'billPreparationDate', so.bill_preparation_date::text) as bill_preparation_date,
         coalesce(stage_payment.stage ->> 'billSentForPaymentDate', so.bill_sent_for_payment_date::text) as bill_sent_for_payment_date,
	         coalesce(stage_payment.stage ->> 'paymentDate', so.payment_date::text) as payment_date,
	         coalesce(stage_payment.stage ->> 'dpDate', so.dp_date::text) as dp_date,
	         coalesce(stage_payment.stage ->> 'revisedDp', so.revised_dp::text) as revised_dp,
	         coalesce(stage_payment.stage -> 'completedMilestones', so.completed_milestones, '[]'::jsonb) as completed_milestones,
	         so.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_payment(stage)
         on not (${isYesExpression("so.stage_delivery")} and not ${isYesExpression("so.stage_payment")})
           and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
       ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
       union all
       select
         ${divisionNameSql} as name,
         f.file_type,
         f.ir as file_ir,
         f.material_receipt_date::text as material_receipt_date,
         ''::text as job_completion_date,
         f.bill_preparation_date::text as bill_preparation_date,
         f.bill_sent_for_payment_date::text as bill_sent_for_payment_date,
	         f.payment_date::text as payment_date,
	         f.dp_date::text as dp_date,
	         f.revised_dp::text as revised_dp,
	         '[]'::jsonb as completed_milestones,
	         f.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [...fileRankingConditions, `not ${supplyOrderRowExists()}`])}
     )
     select name, count(*)::integer as count
     from effective_payment_rows
     where not ${isYesExpression("so_cancelled")}
       and (
			         (
			           (not ${isYesExpression("file_ir")}
			             or lower(trim(coalesce(file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			           and coalesce(job_completion_date, '') <> ''
		         )
         or (
	         ${isYesExpression("file_ir")}
	         and lower(trim(coalesce(file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
	         and coalesce(material_receipt_date, '') <> ''
         )
         or coalesce(bill_preparation_date, '') <> ''
         or coalesce(bill_sent_for_payment_date, '') <> ''
       )
       and coalesce(payment_date, '') = ''
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const thresholdRows: ThresholdAnalyticsRow[] = [];
  const unmatched = {
    name: "Unmatched",
    source: "demand" as const,
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capitalCount: 0,
    revenueCount: 0,
    capital: 0,
    revenue: 0,
    value: 0,
    countContribution: 0,
    capitalCountContribution: 0,
    revenueCountContribution: 0,
    capitalContribution: 0,
    revenueContribution: 0,
    valueContribution: 0,
  };
  const previousThresholdMatches: string[] = [];
  for (const level of valueThresholdLevels) {
    const capital = inrAmountExpression("f.value_capital");
    const revenue = inrAmountExpression("f.value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = [`${amount} > 0`];
    if (level.appliesTo !== "both")
      levelMatchConditions.push(`${valueType} = '${level.appliesTo}'`);
    const minValue = Number(
      String(level.minValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    const maxValue = Number(
      String(level.maxValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} >= ${minValue}`);
    }
    if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} <= ${maxValue}`);
    }
    const levelMatch = `(${levelMatchConditions.join(" and ")})`;
    const thresholdConditions = [
      ...fileRankingConditions,
      `not ${isCancelledExpression()}`,
      levelMatch,
    ];
    if (previousThresholdMatches.length) {
      thresholdConditions.push(`not (${previousThresholdMatches.join(" or ")})`);
    }
    const thresholdResult = await pool.query<{
      count: number;
      capital_count: number;
      revenue_count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              count(*) filter (where ${valueType} = 'capital')::integer as capital_count,
              count(*) filter (where ${valueType} = 'revenue')::integer as revenue_count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, thresholdConditions)}`,
      fileRankingValues,
    );
    const row = thresholdResult.rows[0];
    thresholdRows.push({
      name: level.label,
      source: "demand",
      appliesTo: formatThresholdAppliesTo(level.appliesTo),
      range: formatThresholdRange(level),
      count: Number(row?.count ?? 0),
      capitalCount: Number(row?.capital_count ?? 0),
      revenueCount: Number(row?.revenue_count ?? 0),
      capital: Math.round(Number(row?.capital ?? 0)),
      revenue: Math.round(Number(row?.revenue ?? 0)),
      value: Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0)),
      countContribution: 0,
      capitalCountContribution: 0,
      revenueCountContribution: 0,
      capitalContribution: 0,
      revenueContribution: 0,
      valueContribution: 0,
    });
    previousThresholdMatches.push(levelMatch);
  }
  if (valueThresholdLevels.length) {
    const capital = inrAmountExpression("f.value_capital");
    const revenue = inrAmountExpression("f.value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = valueThresholdLevels.map((level) => {
      const conditions = [`${amount} > 0`];
      if (level.appliesTo !== "both") conditions.push(`${valueType} = '${level.appliesTo}'`);
      const minValue = Number(
        String(level.minValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      const maxValue = Number(
        String(level.maxValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
        conditions.push(`${amount} >= ${minValue}`);
      }
      if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
        conditions.push(`${amount} <= ${maxValue}`);
      }
      return `(${conditions.join(" and ")})`;
    });
    const unmatchedResult = await pool.query<{
      count: number;
      capital_count: number;
      revenue_count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              count(*) filter (where ${valueType} = 'capital')::integer as capital_count,
              count(*) filter (where ${valueType} = 'revenue')::integer as revenue_count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${isCancelledExpression()}`,
         `${amount} > 0`,
         `not (${levelMatchConditions.join(" or ")})`,
       ])}`,
      fileRankingValues,
    );
    const row = unmatchedResult.rows[0];
    unmatched.count = Number(row?.count ?? 0);
    unmatched.capitalCount = Number(row?.capital_count ?? 0);
    unmatched.revenueCount = Number(row?.revenue_count ?? 0);
    unmatched.capital = Math.round(Number(row?.capital ?? 0));
    unmatched.revenue = Math.round(Number(row?.revenue ?? 0));
    unmatched.value = Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0));
  }

  const soThresholdRows: ThresholdAnalyticsRow[] = [];
  const soUnmatched = {
    name: "Unmatched",
    source: "supplyOrder" as const,
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capitalCount: 0,
    revenueCount: 0,
    capital: 0,
    revenue: 0,
    value: 0,
    countContribution: 0,
    capitalCountContribution: 0,
    revenueCountContribution: 0,
    capitalContribution: 0,
    revenueContribution: 0,
    valueContribution: 0,
  };
  const previousSoThresholdMatches: string[] = [];
  for (const level of valueThresholdLevels) {
    const capital = inrAmountExpression("so.so_value_capital");
    const revenue = inrAmountExpression("so.so_value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = [`${amount} > 0`];
    if (level.appliesTo !== "both")
      levelMatchConditions.push(`${valueType} = '${level.appliesTo}'`);
    const minValue = Number(
      String(level.minValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    const maxValue = Number(
      String(level.maxValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} >= ${minValue}`);
    }
    if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} <= ${maxValue}`);
    }
    const levelMatch = `(${levelMatchConditions.join(" and ")})`;
    const thresholdConditions = [
      ...fileRankingConditions,
      `not ${isYesExpression("so.so_cancelled")}`,
      `not ${isYesExpression("so.shortclosure")}`,
      levelMatch,
    ];
    if (previousSoThresholdMatches.length) {
      thresholdConditions.push(`not (${previousSoThresholdMatches.join(" or ")})`);
    }
    const thresholdResult = await pool.query<{
      count: number;
      capital_count: number;
      revenue_count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              count(*) filter (where ${valueType} = 'capital')::integer as capital_count,
              count(*) filter (where ${valueType} = 'revenue')::integer as revenue_count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${appendDashboardWhereClause(whereSql, thresholdConditions)}`,
      fileRankingValues,
    );
    const row = thresholdResult.rows[0];
    soThresholdRows.push({
      name: level.label,
      source: "supplyOrder",
      appliesTo: formatThresholdAppliesTo(level.appliesTo),
      range: formatThresholdRange(level),
      count: Number(row?.count ?? 0),
      capitalCount: Number(row?.capital_count ?? 0),
      revenueCount: Number(row?.revenue_count ?? 0),
      capital: Math.round(Number(row?.capital ?? 0)),
      revenue: Math.round(Number(row?.revenue ?? 0)),
      value: Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0)),
      countContribution: 0,
      capitalCountContribution: 0,
      revenueCountContribution: 0,
      capitalContribution: 0,
      revenueContribution: 0,
      valueContribution: 0,
    });
    previousSoThresholdMatches.push(levelMatch);
  }
  if (valueThresholdLevels.length) {
    const capital = inrAmountExpression("so.so_value_capital");
    const revenue = inrAmountExpression("so.so_value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = valueThresholdLevels.map((level) => {
      const conditions = [`${amount} > 0`];
      if (level.appliesTo !== "both") conditions.push(`${valueType} = '${level.appliesTo}'`);
      const minValue = Number(
        String(level.minValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      const maxValue = Number(
        String(level.maxValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
        conditions.push(`${amount} >= ${minValue}`);
      }
      if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
        conditions.push(`${amount} <= ${maxValue}`);
      }
      return `(${conditions.join(" and ")})`;
    });
    const unmatchedResult = await pool.query<{
      count: number;
      capital_count: number;
      revenue_count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              count(*) filter (where ${valueType} = 'capital')::integer as capital_count,
              count(*) filter (where ${valueType} = 'revenue')::integer as revenue_count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${isYesExpression("so.so_cancelled")}`,
         `not ${isYesExpression("so.shortclosure")}`,
         `${amount} > 0`,
         `not (${levelMatchConditions.join(" or ")})`,
       ])}`,
      fileRankingValues,
    );
    const row = unmatchedResult.rows[0];
    soUnmatched.count = Number(row?.count ?? 0);
    soUnmatched.capitalCount = Number(row?.capital_count ?? 0);
    soUnmatched.revenueCount = Number(row?.revenue_count ?? 0);
    soUnmatched.capital = Math.round(Number(row?.capital ?? 0));
    soUnmatched.revenue = Math.round(Number(row?.revenue ?? 0));
    soUnmatched.value = Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0));
  }

  const valueValues = [...values];
  const valueConditions: string[] = [];
  const valueDivision = analyticsDivisionExtraCondition(valueValues, divisionName);
  if (valueDivision) valueConditions.push(valueDivision);
  const cancelled = isCancelledExpression();
  const demandCapital = inrAmountExpression("f.value_capital");
  const demandRevenue = inrAmountExpression("f.value_revenue");
  const committedCapital = committedValueExpression("f.so_value_capital", "so_value_capital");
  const committedRevenue = committedValueExpression("f.so_value_revenue", "so_value_revenue");
  const valueResult = await pool.query<{
    name: string;
    intended_capital: string | number;
    intended_revenue: string | number;
    booked_capital: string | number;
    booked_revenue: string | number;
    committed_capital: string | number;
    committed_revenue: string | number;
  }>(
    `select
       ${divisionNameSql} as name,
       coalesce(sum(case when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${demandCapital} else 0 end), 0)
         as intended_capital,
       coalesce(sum(case when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${demandRevenue} else 0 end), 0)
         as intended_revenue,
       coalesce(sum(case when not ${cancelled} and ${hasFilledExpression("f.imms")} and ${committedCapital} <= 0 then ${demandCapital} else 0 end), 0)
         as booked_capital,
       coalesce(sum(case when not ${cancelled} and ${hasFilledExpression("f.imms")} and ${committedRevenue} <= 0 then ${demandRevenue} else 0 end), 0)
         as booked_revenue,
       coalesce(sum(${committedCapital}), 0)
         as committed_capital,
       coalesce(sum(${committedRevenue}), 0)
         as committed_revenue
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, valueConditions)}
     group by 1`,
    valueValues,
  );

  const divisionValues = new Map<
    string,
    Omit<
      DivisionValueAnalyticsRow,
      "name" | "allocatedTotal" | "intendedTotal" | "bookedTotal" | "committedTotal"
    >
  >();
  const getDivisionValues = (name: string) =>
    divisionValues.get(name) ?? {
      allocatedCapital: 0,
      allocatedRevenue: 0,
      intendedCapital: 0,
      intendedRevenue: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      committedCapital: 0,
      committedRevenue: 0,
    };
  for (const division of divisions) {
    const name = division.name?.trim() || "Unassigned";
    const current = getDivisionValues(name);
    divisionValues.set(name, {
      ...current,
      allocatedCapital:
        current.allocatedCapital +
        (Number(String(division.allocatedCapital ?? "").replace(/,/g, "")) || 0),
      allocatedRevenue:
        current.allocatedRevenue +
        (Number(String(division.allocatedRevenue ?? "").replace(/,/g, "")) || 0),
    });
  }
  for (const row of valueResult.rows) {
    const current = getDivisionValues(row.name);
    divisionValues.set(row.name, {
      allocatedCapital: current.allocatedCapital,
      allocatedRevenue: current.allocatedRevenue,
      intendedCapital: current.intendedCapital + Number(row.intended_capital ?? 0),
      intendedRevenue: current.intendedRevenue + Number(row.intended_revenue ?? 0),
      bookedCapital: current.bookedCapital + Number(row.booked_capital ?? 0),
      bookedRevenue: current.bookedRevenue + Number(row.booked_revenue ?? 0),
      committedCapital: current.committedCapital + Number(row.committed_capital ?? 0),
      committedRevenue: current.committedRevenue + Number(row.committed_revenue ?? 0),
    });
  }

  return {
    divisionFileRanking: fileRankingResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    divisionValueRanking: roundDivisionValueRows(divisionValues),
    divisionTurnaroundRanking: turnaroundResult.rows.map((row) => ({
      name: row.name,
      averageDays: Number(row.averageDays ?? 0),
      sampleSize: Number(row.sampleSize ?? 0),
    })),
    topFirmSupplyOrders: firmResult.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    topIndentorsByFiles: indentorFileResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    topIndentorsByValue: indentorValueResult.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    milestoneClearingRanking: milestoneResult.rows
      .filter((row) => Number(row.sampleSize ?? 0) > 0)
      .map((row) => ({
        name: row.name,
        averageDays: Number(row.averageDays ?? 0),
        cumulativeDays: Number(row.cumulativeDays ?? 0),
        minDays: Number(row.minDays ?? 0),
        maxDays: Number(row.maxDays ?? 0),
        medianDays: Number(row.medianDays ?? 0),
        sampleSize: Number(row.sampleSize ?? 0),
        sortOrder: Number(row.sort_order ?? 0),
      })),
    monthlyFileInflow: monthlyResult.rows
      .map((row) => ({ name: row.name, count: Number(row.count ?? 0) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    monthWiseSupplyOrder: monthWiseSupplyOrderResult.rows
      .map((row) => ({
        name: row.name,
        monthKey: row.monthKey,
        count: Number(row.count ?? 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    monthWiseDeliverySchedule: monthWiseDeliveryScheduleResult.rows
      .map((row) => ({
        name: row.name,
        monthKey: row.monthKey,
        grossCount: Number(row.grossCount ?? 0),
        netCount: Number(row.netCount ?? 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    biddingModeMix: biddingModeResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    fileValueThresholds: finalizeThresholdAnalyticsRows(
      unmatched.count ? [...thresholdRows, unmatched] : thresholdRows,
    ),
    soValueThresholds: finalizeThresholdAnalyticsRows(
      soUnmatched.count ? [...soThresholdRows, soUnmatched] : soThresholdRows,
    ),
    divisionRiskRanking: riskResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    divisionPaymentPendingRanking: paymentPendingResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
  };
}

async function loadMonthWiseDeliveryScheduleRows({
  whereSql,
  values,
}: {
  whereSql: string;
  values: unknown[];
}) {
  const queryValues = [...values];
  const result = await pool.query<MonthWiseDeliveryScheduleAnalyticsRow>(
    `with effective_delivery_rows as (
       select
         coalesce(
           nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
           nullif(stage_delivery.stage ->> 'dpDate', '')::date,
           so.revised_dp,
           so.dp_date
         ) as dp_date,
         case
           when stage_delivery.stage is not null then (
	             (
		               ${isYesExpression("f.ir")}
		               and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
		               and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> ''
		             )
			             or (
			               (not ${isYesExpression("f.ir")}
			                 or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			               and coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''
		             )
	             or exists (
               select 1
               from jsonb_array_elements_text(
                 coalesce(stage_delivery.stage -> 'completedMilestones', '[]'::jsonb)
               ) as completed_stage(milestone)
               where ${normalizeMilestoneExpression("completed_stage.milestone")} = 'delivery'
             )
           )
           else (
	             (
		               ${isYesExpression("f.ir")}
		               and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
		               and ${hasFilledExpression("so.material_receipt_date")}
		             )
			             or (
			               (not ${isYesExpression("f.ir")}
			                 or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			               and ${hasFilledExpression("so.job_completion_date")}
		             )
	             or ${completedOrderMilestoneExpression("so", "Delivery")}
           )
         end as fructified
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
         on ${isYesExpression("so.stage_delivery")}
           and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
       ${appendDashboardWhereClause(whereSql, [
         `not ${isCancelledExpression()}`,
         `not ${isYesExpression("so.so_cancelled")}`,
       ])}
     )
     select to_char(dp_date, 'YYYY-MM') as name,
            to_char(dp_date, 'YYYY-MM') as "monthKey",
            count(*)::integer as "grossCount",
            count(*) filter (where not fructified)::integer as "netCount"
     from effective_delivery_rows
     where dp_date is not null
     group by 1, 2
     order by name`,
    queryValues,
  );

  return result.rows.map((row) => ({
    name: row.name,
    monthKey: row.monthKey,
    grossCount: Number(row.grossCount ?? 0),
    netCount: Number(row.netCount ?? 0),
  }));
}

async function loadMiscellaneousCounts({
  whereSql,
  values,
  activeDivision,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
}): Promise<MiscellaneousCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const miscellaneousWhereSql = appendDashboardWhereClause(whereSql, extraConditions);
  const result = await pool.query<Record<string, string | number>>(
    `with effective_supply_orders as (
       select
         f.id as file_id,
         so.ld,
         so.demand_cancelled,
         so.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
	       join supply_orders so on so.file_id = f.id
	       ${miscellaneousWhereSql}
	     )
     select
       count(*) filter (
         where not ${fileClosedExpression()} and not ${isCancelledExpression()}
       )::integer as live_files,
       count(*) filter (
         where ${fileClosedExpression()} and not ${isCancelledExpression()}
       )::integer as file_closed,
       (select count(*) from effective_supply_orders eso where ${isYesExpression("eso.ld")} and not ${effectiveOrderCancelledExpression("eso")})::integer as ld,
       count(*) filter (
         where ${isYesExpression("f.demand_cancelled")}
       )::integer as demand_cancelled,
       count(*) filter (
         where exists (
           select 1 from supply_orders so
           where so.file_id = f.id and ${isYesExpression("so.so_cancelled")}
         )
       )::integer as so_cancelled,
       count(*) filter (
         where exists (
           select 1 from supply_orders so
           where so.file_id = f.id and ${isYesExpression("so.shortclosure")}
         )
       )::integer as shortclosed_so,
       count(*) filter (
         where greatest(coalesce(f.no_of_so, 0), (
           select count(*)
           from supply_orders so
           where so.file_id = f.id and not ${isYesExpression("so.so_cancelled")}
         )::integer) > 1
         and not ${isCancelledExpression()}
       )::integer as multiple_supply_orders
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);
  return {
    liveFiles: readCount("live_files"),
    fileClosed: readCount("file_closed"),
    ld: readCount("ld"),
    demandCancelled: readCount("demand_cancelled"),
    soCancelled: readCount("so_cancelled"),
    shortclosedSo: readCount("shortclosed_so"),
    multipleSupplyOrders: readCount("multiple_supply_orders"),
  };
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeLiveStatusMilestoneName(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(
    dedupeLiveStatusMilestones(
      insertAdvancePaymentMilestone(
        insertSupplementaryBillReturnedMilestone(
          insertBillSentMilestone(
            insertJobCompletionMilestone(insertRefloatMilestones(configured)),
          ),
        ),
      ),
    ),
  );
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

function insertSupplementaryBillReturnedMilestone(milestones: string[]) {
  const hasSupplementaryBillReturned = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "supplementarybillreturnedforcorrection",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasSupplementaryBillReturned || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Supplementary bill returned for correction",
    ...milestones.slice(paymentIndex),
  ];
}

function insertAdvancePaymentMilestone(milestones: string[]) {
  const hasAdvancePayment = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "advancepayment",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasAdvancePayment || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Advance Payment",
    ...milestones.slice(paymentIndex),
  ];
}

function insertJobCompletionMilestone(milestones: string[]) {
  const hasJobCompletion = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "jobcompletion",
  );
  const deliveryIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "deliveryperiod",
  );
  if (hasJobCompletion || deliveryIndex === -1) return milestones;
  return [
    ...milestones.slice(0, deliveryIndex + 1),
    "Job Completion",
    ...milestones.slice(deliveryIndex + 1),
  ];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function normalizeLiveStatusMilestoneName(milestone: string) {
  const configured = normalizeConfiguredMilestoneLabel(milestone);
  const normalized = normalizeMilestoneName(configured);
  if (normalized === "delivery") return "Delivery Period";
  return configured;
}

function getLiveStatusMilestoneLabel(milestone: string) {
  if (normalizeMilestoneName(milestone) === "supplementarybillreturnedforcorrection") {
    return "Supp. bill returned";
  }
  return normalizeMilestoneName(milestone) === "deliveryperiod" ? "D.P." : milestone;
}

function dedupeLiveStatusMilestones(milestones: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  milestones.forEach((milestone) => {
    const name = normalizeLiveStatusMilestoneName(milestone);
    const normalized = normalizeMilestoneName(name);
    if (!name || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(name);
  });
  return deduped;
}

function getVisibleLiveMilestoneNames(
  liveMilestones: string[] | undefined,
  manualMilestoneFlow: Array<{ name: string }>,
) {
  const available = new Set(manualMilestoneFlow.map((milestone) => milestone.name));
  const visible = dedupeLiveStatusMilestones(
    liveMilestones
      ?.map((name) => normalizeLiveStatusMilestoneName(name))
      .filter((name) => available.has(name)) ??
      manualMilestoneFlow.map((milestone) => milestone.name),
  );
  protectedLiveStatusMilestones.forEach((milestone) => {
    if (available.has(milestone) && !visible.includes(milestone)) visible.push(milestone);
  });
  return visible;
}

async function loadManualMilestoneSqlSlice({
  whereSql,
  values,
  activeDivision,
  divisions,
  configuredMilestones,
  liveMilestones,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
  divisions: Division[];
  configuredMilestones: string[];
  liveMilestones?: string[];
}): Promise<ManualMilestoneSqlSlice> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const liveConfiguredMilestones = dedupeLiveStatusMilestones(
    configuredMilestones.filter(
      (milestone) =>
        normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
    ),
  );
  const extrasValues = [...queryValues];
  const configuredPlaceholder = addValue(extrasValues, liveConfiguredMilestones);
  const extrasResult = await pool.query<{ name: string }>(
    `select distinct trim(f.current_milestone) as name
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...extraConditions,
       "trim(coalesce(f.current_milestone, '')) <> ''",
       `not (trim(f.current_milestone) = any(${configuredPlaceholder}::text[]))`,
     ])}
     order by name asc`,
    extrasValues,
  );
  const milestoneNames = dedupeLiveStatusMilestones([
    ...liveConfiguredMilestones,
    ...extrasResult.rows
      .map((row) => row.name)
      .filter(Boolean)
      .map((name) => normalizeLiveStatusMilestoneName(name)),
  ]);
  const supplyOrderDrivenManualMilestones = [
    "financialsanction",
    "supplyorder",
    "bankguarantee",
    "deliveryperiod",
    "delivery",
    "jobcompletion",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "advancepayment",
    "payment",
  ];
  const supplyOrderDrivenManualMilestoneList = supplyOrderDrivenManualMilestones
    .map((name) => `'${name}'`)
    .join(", ");
  const currentValues = [...queryValues];
  const currentMilestonePlaceholder = addValue(currentValues, milestoneNames);
  const currentResult = await pool.query<{ name: string; count: number }>(
    `select milestone.name,
            case
              when ${normalizeMilestoneExpression("milestone.name")} = 'refloatbidding' then (
                select count(*)::integer
                from files f
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(whereSql, [
                  ...extraConditions,
                  `not ${isCancelledExpression()}`,
                  `${isYesExpression("f.refloat")}`,
                  `not ${isYesExpression("f.bidding_stage_over")}`,
                ])}
              )
              when ${normalizeMilestoneExpression("milestone.name")} = 'refloatposttcec' then (
                select count(*)::integer
                from files f
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(whereSql, [
                  ...extraConditions,
                  `not ${isCancelledExpression()}`,
                  `${isYesExpression("f.refloat")}`,
                  `${isYesExpression("f.tcec")}`,
                  `${isYesExpression("f.bidding_stage_over")}`,
                  `not ${hasFilledExpression("f.refloat_post_tcec_minutes_date")}`,
                ])}
              )
              when ${normalizeMilestoneExpression("milestone.name")} = 'advancepayment' then (
                select count(*)::integer
                from supply_orders so_current
                join files f on f.id = so_current.file_id
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(
                  whereSql.replace(/^where/i, "where f.id is not null and"),
                  [
                    ...extraConditions,
                    `not ${isCancelledExpression()}`,
                    `not ${isYesExpression("so_current.so_cancelled")}`,
                    `${isYesExpression("so_current.advance_payment")}`,
                    `${normalizeMilestoneExpression("so_current.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'`,
                    `not ${hasFilledExpression("so_current.advance_payment_detail ->> 'paymentDate'")}`,
                  ],
                )}
	              )
	              when ${normalizeMilestoneExpression("milestone.name")} = 'supplementarybillreturnedforcorrection' then (
	                select count(*)::integer
	                from supply_orders so_current
	                join files f on f.id = so_current.file_id
	                left join divisions d on d.id = f.division_id
	                ${appendDashboardWhereClause(
                    whereSql.replace(/^where/i, "where f.id is not null and"),
                    [
                      ...extraConditions,
                      `not ${isCancelledExpression()}`,
                      `not ${isYesExpression("so_current.so_cancelled")}`,
                      `exists (
                        select 1
                        from jsonb_array_elements(coalesce(so_current.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
                        where not ${hasFilledExpression("supplementary_bill.bill ->> 'paymentDate'")}
                          and exists (
                            select 1
                            from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
                            where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
                              and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
                          )
                      )`,
                    ],
                  )}
	              )
	              when ${normalizeMilestoneExpression("milestone.name")} = 'deliveryperiod' then (
	                select count(*)::integer
	                from supply_orders so_current
	                join files f on f.id = so_current.file_id
	                left join divisions d on d.id = f.division_id
	                ${appendDashboardWhereClause(
                    whereSql.replace(/^where/i, "where f.id is not null and"),
                    [
                      ...extraConditions,
                      `not ${isCancelledExpression()}`,
                      `not ${isYesExpression("so_current.so_cancelled")}`,
                      `${hasFilledExpression("so_current.so_date")}`,
                      `not ${isYesExpression("so_current.stage_delivery")}`,
                      `${effectiveDpDateExpression("so_current")} is null`,
                    ],
                  )}
	              )
	              when ${normalizeMilestoneExpression("milestone.name")} in (${supplyOrderDrivenManualMilestoneList}) then (
                select count(*)::integer
                from supply_orders so_current
                join files f on f.id = so_current.file_id
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(
                  whereSql.replace(/^where/i, "where f.id is not null and"),
                  [
                    ...extraConditions,
                    `not ${isCancelledExpression()}`,
                    `not ${isYesExpression("so_current.so_cancelled")}`,
                    `(
	                      (
	                        ${normalizeMilestoneExpression("so_current.current_milestone")} = ${normalizeMilestoneExpression("milestone.name")}
		                        and ${normalizeMilestoneExpression("milestone.name")} <> 'billsentforpayment'
		                        and ${normalizeMilestoneExpression("milestone.name")} <> 'billreturnedforcorrection'
		                        and ${normalizeMilestoneExpression("milestone.name")} <> 'billpreparation'
			                        and (
			                          ${normalizeMilestoneExpression("milestone.name")} <> 'payment'
			                          or (
			                            not ${hasFilledExpression("so_current.payment_date")}
			                            and not exists (
			                              select 1
			                              from jsonb_array_elements(coalesce(so_current.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
			                              where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
			                                and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
			                            )
			                          )
			                        )
		                          and (
		                            ${normalizeMilestoneExpression("milestone.name")} <> 'jobcompletion'
		                          or not ${effectiveOrderCompletedMilestoneExpression("Job Completion", "so_current")}
		                        )
		                      )
				                      or (
				                        ${normalizeMilestoneExpression("milestone.name")} = 'billsentforpayment'
				                        and ${hasFilledExpression("so_current.bill_preparation_date")}
				                        and not ${hasFilledExpression("so_current.bill_sent_for_payment_date")}
				                      )
				                      or (
				                        ${normalizeMilestoneExpression("milestone.name")} = 'billreturnedforcorrection'
				                        and exists (
				                          select 1
				                          from jsonb_array_elements(coalesce(so_current.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
				                          where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
				                            and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
				                        )
				                      )
			                      or (
			                        ${normalizeMilestoneExpression("milestone.name")} = 'billpreparation'
			                        and not ${hasFilledExpression("so_current.bill_preparation_date")}
			                        and (
			                          (${isYesExpression("f.ir")} and ${hasFilledExpression("so_current.ir_receipt_date")})
			                          or ((not ${isYesExpression("f.ir")}
			                            or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			                            and ${hasFilledExpression("so_current.job_completion_date")})
			                        )
			                      )
			                      or (
			                        ${normalizeMilestoneExpression("milestone.name")} = 'jobcompletion'
			                        and ${hasFilledExpression("so_current.so_date")}
		                        and (not ${isYesExpression("f.ir")}
		                          or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
		                        and not ${effectiveOrderCompletedMilestoneExpression("Job Completion", "so_current")}
		                        and ${effectiveDpDateExpression("so_current")} is not null
		                        and ${effectiveDpDateExpression("so_current")} < current_date
		                      )
		                      or exists (
		                        select 1
		                        from jsonb_array_elements(coalesce(so_current.stage_deliveries, '[]'::jsonb)) as current_stage(stage)
		                        where (
				                          (
				                            ${normalizeMilestoneExpression("current_stage.stage ->> 'currentMilestone'")} = ${normalizeMilestoneExpression("milestone.name")}
				                            and ${normalizeMilestoneExpression("milestone.name")} <> 'jobcompletion'
				                            and ${normalizeMilestoneExpression("milestone.name")} <> 'billsentforpayment'
				                            and ${normalizeMilestoneExpression("milestone.name")} <> 'billpreparation'
			                              and (
				                              ${normalizeMilestoneExpression("milestone.name")} <> 'payment'
				                              or not ${hasFilledExpression("current_stage.stage ->> 'paymentDate'")}
				                            )
				                          )
			                          or (
				                            ${normalizeMilestoneExpression("milestone.name")} = 'billsentforpayment'
				                            and ${hasFilledExpression("current_stage.stage ->> 'billPreparationDate'")}
				                            and not ${hasFilledExpression("current_stage.stage ->> 'billSentForPaymentDate'")}
				                          )
			                          or (
				                            ${normalizeMilestoneExpression("milestone.name")} = 'billpreparation'
				                            and not ${hasFilledExpression("current_stage.stage ->> 'billPreparationDate'")}
				                            and (
				                              (${isYesExpression("f.ir")} and ${hasFilledExpression("current_stage.stage ->> 'irReceiptDate'")})
				                              or ((not ${isYesExpression("f.ir")}
				                                or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
				                                and ${hasFilledExpression("current_stage.stage ->> 'jobCompletionDate'")})
				                            )
				                          )
			                          or (
				                            ${normalizeMilestoneExpression("milestone.name")} = 'jobcompletion'
			                            and (not ${isYesExpression("f.ir")}
			                              or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
			                            and nullif(current_stage.stage ->> 'jobCompletionDate', '')::date is null
		                            and coalesce(
		                              nullif(current_stage.stage ->> 'revisedDp', '')::date,
		                              nullif(current_stage.stage ->> 'dpDate', '')::date,
		                              so_current.revised_dp,
		                              so_current.dp_date
		                            ) < current_date
		                          )
		                        )
		                      )
		                    )`,
                  ],
                )}
              )
              else count(f.id)::integer
            end as count
     from unnest(${currentMilestonePlaceholder}::text[]) as milestone(name)
     left join files f on f.current_milestone = milestone.name
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
     ])}
     group by milestone.name`,
    currentValues,
  );
  const completedValues = [...queryValues];
  const completedMilestonePlaceholder = addValue(completedValues, milestoneNames);
  const completedResult = await pool.query<{ name: string; count: number }>(
    `select milestone.name,
            case
              when ${normalizeMilestoneExpression("milestone.name")} = 'refloatbidding' then (
                select count(*)::integer
                from files f
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(whereSql, [
                  ...extraConditions,
                  `not ${isCancelledExpression()}`,
                  `${isYesExpression("f.refloat")}`,
                  `${isYesExpression("f.bidding_stage_over")}`,
                ])}
              )
              when ${normalizeMilestoneExpression("milestone.name")} = 'refloatposttcec' then (
                select count(*)::integer
                from files f
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(whereSql, [
                  ...extraConditions,
                  `not ${isCancelledExpression()}`,
                  `${isYesExpression("f.refloat")}`,
                  `${isYesExpression("f.tcec")}`,
                  `${hasFilledExpression("f.refloat_post_tcec_minutes_date")}`,
                ])}
              )
              when ${normalizeMilestoneExpression("milestone.name")} = 'advancepayment' then (
                select count(*)::integer
                from supply_orders so_completed
                join files f on f.id = so_completed.file_id
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(
                  whereSql.replace(/^where/i, "where f.id is not null and"),
                  [
                    ...extraConditions,
                    `not ${isCancelledExpression()}`,
                    `not ${isYesExpression("so_completed.so_cancelled")}`,
                    `${isYesExpression("so_completed.advance_payment")}`,
                    `${hasFilledExpression("so_completed.advance_payment_detail ->> 'paymentDate'")}`,
                  ],
                )}
              )
              when ${normalizeMilestoneExpression("milestone.name")} = 'financialsanction' then (
                select count(*)::integer
                from supply_orders so_completed
                join files f on f.id = so_completed.file_id
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(
                  whereSql.replace(/^where/i, "where f.id is not null and"),
                  [
                    ...extraConditions,
                    `not ${isCancelledExpression()}`,
                    `not ${isYesExpression("so_completed.so_cancelled")}`,
                    hasFilledExpression("so_completed.financial_sanction_date"),
                  ],
                )}
              )
              when ${normalizeMilestoneExpression("milestone.name")} in (${supplyOrderDrivenManualMilestoneList}) then (
                select count(*)::integer
                from supply_orders so_completed
                join files f on f.id = so_completed.file_id
                left join divisions d on d.id = f.division_id
                ${appendDashboardWhereClause(
                  whereSql.replace(/^where/i, "where f.id is not null and"),
                  [
                    ...extraConditions,
                    `not ${isCancelledExpression()}`,
                    `not ${isYesExpression("so_completed.so_cancelled")}`,
                    `exists (
                    select 1
                    from jsonb_array_elements_text(coalesce(so_completed.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
                    where ${normalizeMilestoneExpression("completed_order.milestone")} = ${normalizeMilestoneExpression("milestone.name")}
                  )
                  or (${normalizeMilestoneExpression("milestone.name")} = 'jobcompletion' and ${hasFilledExpression("so_completed.job_completion_date")})
                  or (${normalizeMilestoneExpression("milestone.name")} = 'irpreparation' and ${hasFilledExpression("so_completed.ir_preparation_date")})
                  or (${normalizeMilestoneExpression("milestone.name")} = 'irreceipt' and ${hasFilledExpression("so_completed.ir_receipt_date")})
	                  or (${normalizeMilestoneExpression("milestone.name")} = 'billpreparation' and ${hasFilledExpression("so_completed.bill_preparation_date")})
	                  or (${normalizeMilestoneExpression("milestone.name")} = 'billsentforpayment' and ${hasFilledExpression("so_completed.bill_sent_for_payment_date")})
	                  or (${normalizeMilestoneExpression("milestone.name")} = 'billreturnedforcorrection' and exists (
	                    select 1
	                    from jsonb_array_elements(coalesce(so_completed.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
	                    where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
	                      and ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
	                  ))
	                  or (${normalizeMilestoneExpression("milestone.name")} = 'payment' and ${hasFilledExpression("so_completed.payment_date")})
                  or exists (
                    select 1
                    from jsonb_array_elements(coalesce(so_completed.stage_deliveries, '[]'::jsonb)) as completed_stage(stage)
                    where (${normalizeMilestoneExpression("milestone.name")} = 'jobcompletion' and ${hasFilledExpression("completed_stage.stage ->> 'jobCompletionDate'")})
                       or (${normalizeMilestoneExpression("milestone.name")} = 'irpreparation' and ${hasFilledExpression("completed_stage.stage ->> 'irPreparationDate'")})
                       or (${normalizeMilestoneExpression("milestone.name")} = 'irreceipt' and ${hasFilledExpression("completed_stage.stage ->> 'irReceiptDate'")})
                       or (${normalizeMilestoneExpression("milestone.name")} = 'billpreparation' and ${hasFilledExpression("completed_stage.stage ->> 'billPreparationDate'")})
                       or (${normalizeMilestoneExpression("milestone.name")} = 'billsentforpayment' and ${hasFilledExpression("completed_stage.stage ->> 'billSentForPaymentDate'")})
                       or (${normalizeMilestoneExpression("milestone.name")} = 'payment' and ${hasFilledExpression("completed_stage.stage ->> 'paymentDate'")})
                  )`,
                  ],
                )}
              )
              else count(completed.file_id) filter (where not ${isCancelledExpression()})::integer
            end as count
     from unnest(${completedMilestonePlaceholder}::text[]) as milestone(name)
     left join file_completed_milestones completed on completed.milestone = milestone.name
     left join files f on f.id = completed.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
     ])}
     group by milestone.name`,
    completedValues,
  );
  const currentCounts = new Map(
    currentResult.rows.map((row) => [row.name, Number(row.count ?? 0)]),
  );
  const completedCounts = new Map(
    completedResult.rows.map((row) => [row.name, Number(row.count ?? 0)]),
  );
  const manualMilestoneFlow = milestoneNames.map((name) => ({
    name,
    label: getLiveStatusMilestoneLabel(name),
    current: currentCounts.get(name) ?? 0,
    completed: completedCounts.get(name) ?? 0,
  }));
  const visibleLiveMilestoneNames = getVisibleLiveMilestoneNames(
    liveMilestones,
    manualMilestoneFlow,
  );

  const liveValues = [...queryValues];
  const livePlaceholder = addValue(liveValues, visibleLiveMilestoneNames);
  const liveCountsResult = await pool.query<{ division: string; milestone: string; count: number }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            f.current_milestone as milestone,
            count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
	     ${appendDashboardWhereClause(whereSql, [
         ...extraConditions,
         `f.current_milestone = any(${livePlaceholder}::text[])`,
         `${normalizeMilestoneExpression("f.current_milestone")} <> 'jobcompletion'`,
         `not ${isCancelledExpression()}`,
       ])}
	     group by 1, 2`,
    liveValues,
  );
  const jobCompletionLiveCountsResult = await pool.query<{
    division: string;
    milestone: string;
    count: number;
  }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            'Job Completion'::text as milestone,
            count(*)::integer as count
     from supply_orders so_current
     join files f on f.id = so_current.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so_current.so_cancelled")}`,
       `${hasFilledExpression("so_current.so_date")}`,
       `(not ${isYesExpression("f.ir")}
         or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`,
       `(
		         (
		           ${hasFilledExpression("so_current.so_date")}
		           and not ${completedOrderMilestoneExpression("so_current", "Job Completion")}
		           and ${effectiveDpDateExpression("so_current")} is not null
		           and ${effectiveDpDateExpression("so_current")} < current_date
		         )
		         or exists (
		           select 1
		           from jsonb_array_elements(coalesce(so_current.stage_deliveries, '[]'::jsonb)) as current_stage(stage)
		           where coalesce(
		             nullif(current_stage.stage ->> 'revisedDp', '')::date,
		             nullif(current_stage.stage ->> 'dpDate', '')::date,
		             so_current.revised_dp,
		             so_current.dp_date
		           ) < current_date
		           and nullif(current_stage.stage ->> 'jobCompletionDate', '')::date is null
		         )
		       )`,
     ])}
     group by 1`,
    queryValues,
  );
  const deliveryPeriodLiveCountsResult = await pool.query<{
    division: string;
    milestone: string;
    count: number;
  }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            'Delivery Period'::text as milestone,
            count(*)::integer as count
     from supply_orders so_current
     join files f on f.id = so_current.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so_current.so_cancelled")}`,
       `${hasFilledExpression("so_current.so_date")}`,
       `not ${isYesExpression("so_current.stage_delivery")}`,
       `${effectiveDpDateExpression("so_current")} is null`,
     ])}
     group by 1`,
    queryValues,
  );
  const advancePaymentLiveCountsResult = await pool.query<{
    division: string;
    milestone: string;
    count: number;
  }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            'Advance Payment'::text as milestone,
            count(*)::integer as count
     from supply_orders so_current
     join files f on f.id = so_current.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so_current.so_cancelled")}`,
       `${isYesExpression("so_current.advance_payment")}`,
       `${normalizeMilestoneExpression("so_current.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'`,
       `not ${hasFilledExpression("so_current.advance_payment_detail ->> 'paymentDate'")}`,
     ])}
     group by 1`,
    queryValues,
  );
  const billSentForPaymentLiveCountsResult = await pool.query<{
    division: string;
    milestone: string;
    count: number;
  }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            'Bill sent for payment'::text as milestone,
            count(*)::integer as count
     from supply_orders so_current
     join files f on f.id = so_current.file_id
     left join divisions d on d.id = f.division_id
     left join lateral jsonb_array_elements(coalesce(so_current.stage_deliveries, '[]'::jsonb)) as current_stage(stage)
       on ${isYesExpression("so_current.stage_delivery")}
         and ${isYesExpression("so_current.stage_payment")}
	     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
         ...extraConditions,
         `not ${isCancelledExpression()}`,
         `not ${isYesExpression("so_current.so_cancelled")}`,
         `(
         (
           current_stage.stage is null
           and ${hasFilledExpression("so_current.bill_preparation_date")}
           and not ${hasFilledExpression("so_current.bill_sent_for_payment_date")}
           and not exists (
             select 1
             from jsonb_array_elements(coalesce(so_current.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
             where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
               and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
           )
         )
         or (
           current_stage.stage is not null
           and ${hasFilledExpression("current_stage.stage ->> 'billPreparationDate'")}
           and not ${hasFilledExpression("current_stage.stage ->> 'billSentForPaymentDate'")}
           and not exists (
             select 1
             from jsonb_array_elements(coalesce(current_stage.stage -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
             where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
               and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
           )
         )
       )`,
       ])}
     group by 1`,
    queryValues,
  );
  const supplementaryBillReturnedLiveCountsResult = await pool.query<{
    division: string;
    milestone: string;
    count: number;
  }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            'Supplementary bill returned for correction'::text as milestone,
            count(*)::integer as count
     from supply_orders so_current
     join files f on f.id = so_current.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so_current.so_cancelled")}`,
       `exists (
         select 1
         from jsonb_array_elements(coalesce(so_current.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
         where not ${hasFilledExpression("supplementary_bill.bill ->> 'paymentDate'")}
           and exists (
             select 1
             from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
             where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
               and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
           )
       )`,
     ])}
     group by 1`,
    queryValues,
  );
  const liveCountRows = [
    ...liveCountsResult.rows,
    ...deliveryPeriodLiveCountsResult.rows,
    ...jobCompletionLiveCountsResult.rows,
    ...advancePaymentLiveCountsResult.rows,
    ...billSentForPaymentLiveCountsResult.rows,
    ...supplementaryBillReturnedLiveCountsResult.rows,
  ];
  const divisionNames = Array.from(
    new Set([
      ...divisions.map((division) => division.name),
      ...liveCountRows.map((row) => row.division),
    ]),
  );
  const liveCounts = new Map<string, number>();
  liveCountRows.forEach((row) => {
    const key = `${row.division}\u0000${row.milestone}`;
    liveCounts.set(key, (liveCounts.get(key) ?? 0) + Number(row.count ?? 0));
  });
  const liveStatusRows = divisionNames
    .map((division) => {
      const counts = Object.fromEntries(
        visibleLiveMilestoneNames.map((milestone) => [
          milestone,
          liveCounts.get(`${division}\u0000${milestone}`) ?? 0,
        ]),
      );
      return {
        division,
        counts,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.division.localeCompare(b.division));

  return { manualMilestoneFlow, visibleLiveMilestoneNames, liveStatusRows };
}

async function loadStatusCounts({
  whereSql,
  values,
  activeDivision,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
}): Promise<StatusCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const cancelled = isCancelledExpression();
  const supplyOrderPlaced = supplyOrderPlacedExpression();
  const statusWhereSql = appendDashboardWhereClause(whereSql, extraConditions);
  const bidOpeningDate = `(case when ${isYesExpression(
    "f.refloat",
  )} and f.refloat_bid_opening_date is not null then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  const bidOverdue = `${biddingApplicableExpression()}
    and ${isNoExpression("f.bid_opened")}
    and ${bidOpeningDate} is not null
    and ${bidOpeningDate} < current_date`;
  const milestoneSelects = statusMilestoneDefinitions.flatMap((milestone, index) => {
    const prefix = `milestone_${index}`;
    const applies = statusAppliesExpression(milestone);
    const complete = statusCompleteExpression(milestone);
    const active = `${applies} and ${statusActiveExpression(milestone)}`;
    if (isBgStatusKey(milestone.key)) {
      const category = milestone.key;
      const receivedColumn = bgReceivedColumn(category);
      const validityColumn = bgValidityColumn(category);
      const returnColumn = bgReturnColumn(category);
      const eligible = `not ${effectiveOrderCancelledExpression("eso")} and ${bgCategoryExpression(
        "eso",
        category,
      )}`;
      const received = `${eligible} and (${hasFilledExpression(`eso.${receivedColumn}`)}
        or ${effectiveOrderCompletedMilestoneExpression(milestone.label)})`;
      const normalizedBg = normalizeMilestoneName(category);
      const deliveryPurposeComplete = `(
        (${isYesExpression("eso.file_ir")} and ${hasFilledExpression("eso.material_receipt_date")})
        or (not ${isYesExpression("eso.file_ir")} and ${effectiveOrderCompletedMilestoneExpression(
          "Job Completion",
        )})
      )`;
      const stageRowsExist = `${isYesExpression("eso.stage_delivery")} and jsonb_array_length(coalesce(eso.stage_deliveries, '[]'::jsonb)) > 0`;
      const allStagesHaveIrReceipt = `not exists (
        select 1 from jsonb_array_elements(coalesce(eso.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
        where coalesce(psb_stage.stage ->> 'irReceiptDate', '') = ''
      )`;
      const allStagesHaveJobCompletion = `not exists (
	        select 1 from jsonb_array_elements(coalesce(eso.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
	        where nullif(psb_stage.stage ->> 'jobCompletionDate', '')::date is null
	      )`;
      const psbPurposeComplete = `(
        (lower(trim(coalesce(eso.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
          and ((${stageRowsExist} and ${allStagesHaveJobCompletion}) or (not (${stageRowsExist}) and ${effectiveOrderCompletedMilestoneExpression(
            "Job Completion",
          )})))
        or (
          lower(trim(coalesce(eso.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
          and (
            (${isYesExpression("eso.file_ir")} and ((${stageRowsExist} and ${allStagesHaveIrReceipt}) or (not (${stageRowsExist}) and ${hasFilledExpression("eso.ir_receipt_date")})))
            or (not ${isYesExpression("eso.file_ir")} and ((${stageRowsExist} and ${allStagesHaveJobCompletion}) or (not (${stageRowsExist}) and ${effectiveOrderCompletedMilestoneExpression(
              "Job Completion",
            )})))
          )
        )
      )`;
      const pendingStarted =
        normalizedBg === "pwb"
          ? deliveryPurposeComplete
          : hasFilledExpression("eso.financial_sanction_date");
      const pending = `${eligible} and ${pendingStarted} and not (${hasFilledExpression(
        `eso.${receivedColumn}`,
      )} or ${effectiveOrderCompletedMilestoneExpression(milestone.label)})`;
      const expired = `${received}
        and not ${hasFilledExpression(`eso.${returnColumn}`)}
        and (
          ('${normalizedBg}' = 'psb' and not (${psbPurposeComplete}))
          or ('${normalizedBg}' <> 'psb' and not ${hasFilledExpression("eso.payment_date")})
        )
        and ${hasFilledExpression(`eso.${validityColumn}`)}
        and eso.${validityColumn} < current_date`;
      const toBeReturned = `${received}
        and not ${hasFilledExpression(`eso.${returnColumn}`)}
        and (
          ${isYesExpression("eso.so_cancelled")}
          or ${isYesExpression("eso.shortclosure")}
          or (
            not ${isYesExpression("eso.so_cancelled")}
            and not ${isYesExpression("eso.shortclosure")}
            and (
              ('${normalizedBg}' = 'psb'
                and ${psbPurposeComplete})
              or (
                '${normalizedBg}' <> 'psb'
                and ${hasFilledExpression("eso.warranty_period_date")}
                and eso.warranty_period_date + interval '60 day' < current_date
              )
            )
          )
        )`;
      const cleared = received;
      return [
        `${effectiveOrderCountFilter(eligible)} as ${prefix}_total`,
        `0::integer as ${prefix}_under_process`,
        `${effectiveOrderCountFilter(pending)} as ${prefix}_active`,
        `${effectiveOrderCountFilter(pending)} as ${prefix}_pending`,
        `0::integer as ${prefix}_reviewed`,
        `${effectiveOrderCountFilter(cleared)} as ${prefix}_cleared`,
        `${effectiveOrderCountFilter(expired)} as ${prefix}_bg_expired`,
        `${effectiveOrderCountFilter(toBeReturned)} as ${prefix}_bg_to_be_returned`,
      ];
    }
    const reviewed = statusReviewedExpression(milestone);
    return [
      `${countFilter(applies)} as ${prefix}_total`,
      `${countFilter(statusPreviousStageExpression(milestone, index))} as ${prefix}_under_process`,
      `${countFilter(active)} as ${prefix}_active`,
      `${countFilter(
        milestone.key === "refloatPostTcec"
          ? `${applies} and not (${complete})`
          : "reviewedColumn" in milestone && milestone.reviewedColumn
            ? `${active} and not (${reviewed}) and not (${complete})`
            : `${active} and not (${complete})`,
      )} as ${prefix}_pending`,
      `${countFilter(`${active} and ${reviewed} and not (${complete})`)} as ${prefix}_reviewed`,
      `${countFilter(`${applies} and ${complete}`)} as ${prefix}_cleared`,
    ];
  });
  const result = await pool.query<Record<string, string | number>>(
    `with effective_supply_orders as (
	       select
	         f.id as file_id,
           f.file_type,
	         f.bg as file_bg,
	         f.ir as file_ir,
         f.psb,
	         f.demand_cancelled as file_demand_cancelled,
	         f.so_cancelled as file_so_cancelled,
	         so.current_milestone,
	         so.completed_milestones,
	         so.financial_sanction_date,
		         so.so_date,
         so.dp_date,
         so.revised_dp,
	         so.material_receipt_date,
           so.job_completion_date,
	         so.ir_preparation_date,
	         so.ir_receipt_date,
         so.payment_date,
         so.psb_applicable,
         so.bg_coverage_type,
         so.psb_bg_received_date,
         so.psb_bg_validity_date,
         so.psb_bg_return_date,
         so.pwb_bg_received_date,
         so.pwb_bg_validity_date,
         so.pwb_bg_return_date,
         so.combined_bg_received_date,
         so.combined_bg_validity_date,
         so.combined_bg_return_date,
         so.warranty_period_date,
         so.ld,
         so.stage_delivery,
         so.stage_deliveries,
         so.demand_cancelled,
         so.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
	       join supply_orders so on so.file_id = f.id
	       ${statusWhereSql}
	       union all
	       select
	         f.id as file_id,
           f.file_type,
	         f.bg as file_bg,
	         f.ir as file_ir,
         f.psb,
	         f.demand_cancelled as file_demand_cancelled,
	         f.so_cancelled as file_so_cancelled,
	         'Supply Order'::text as current_milestone,
	         '[]'::jsonb as completed_milestones,
	         null::date as financial_sanction_date,
		         null::date as so_date,
         null::date as dp_date,
         null::date as revised_dp,
	         null::date as material_receipt_date,
           null::date as job_completion_date,
	         null::date as ir_preparation_date,
	         null::date as ir_receipt_date,
         null::date as payment_date,
         null::text as psb_applicable,
         null::text as bg_coverage_type,
         null::date as psb_bg_received_date,
         null::date as psb_bg_validity_date,
         null::date as psb_bg_return_date,
         null::date as pwb_bg_received_date,
         null::date as pwb_bg_validity_date,
         null::date as pwb_bg_return_date,
         null::date as combined_bg_received_date,
         null::date as combined_bg_validity_date,
         null::date as combined_bg_return_date,
         null::date as warranty_period_date,
         null::text as ld,
         null::text as stage_delivery,
         '[]'::jsonb as stage_deliveries,
         f.demand_cancelled,
         'No'::text as so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       cross join lateral generate_series(
         1,
         greatest(
           coalesce(f.no_of_so, 0) - (
             select count(*)::integer from supply_orders so_count where so_count.file_id = f.id
           ),
           0
         )
       ) as missing_supply_order(n)
       ${statusWhereSql}
     )
     select
       ${milestoneSelects.join(",\n       ")},
      ${countFilter(`${biddingApplicableExpression()} and ${isYesExpression("f.tender_live")}`)} as live_bids,
      ${countFilter(bidOverdue)} as overdue_bids,
      ${countFilter(
        `not ${cancelled}
          and ${biddingApplicableExpression()}
          and regexp_replace(lower(coalesce(f.current_milestone, '')), '[^a-z0-9]+', '', 'g') = 'bidding'
          and not ${isYesExpression("f.tender_live")}
          and not (${bidOverdue})`,
      )} as in_process_bids,
       ${effectiveOrderCountFilter("true")} as order_supply_order_total,
	       ${effectiveOrderCountFilter(effectiveOrderPlacedExpression())} as order_supply_order_placed,
	       ${effectiveOrderCountFilter(financialSanctionPendingExpression())} as order_financial_sanction_pending,
	       ${effectiveOrderCountFilter(
           `not ${effectiveOrderCancelledExpression()} and ${hasFilledExpression(
             "eso.financial_sanction_date",
           )}`,
         )} as order_financial_sanction_completed,
       ${countFilter(financialSanctionPreviousStageExpression())} as order_financial_sanction_previous_stage,
	       ${effectiveOrderCountFilter(
           `not ${effectiveOrderCancelledExpression()} and ${effectiveOrderCurrentMilestoneExpression(
             "Supply Order",
           )}`,
         )} as order_supply_order_pending,
       ${effectiveOrderCountFilter(effectiveOrderPaymentOpenExpression())} as live_supply_orders,
       (
         select count(*)::integer
         from ${dashboardPaymentRowsSource(whereSql, extraConditions)} payment_row
         where ${paymentRowCompletedExpression("payment_row")}
       ) as order_payment_completed,
       (
         select count(*)::integer
         from ${dashboardPaymentRowsSource(whereSql, extraConditions)} payment_row
         where ${paymentRowPendingExpression("payment_row")}
       ) as order_payment_pending,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryCompletedExpression())} as delivery_completed,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryPendingExpression())} as delivery_due,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryOverdueExpression())} as delivery_overdue,
       ${effectiveOrderCountFilter(effectiveOrderJobCompletionCompletedExpression())} as job_completion_completed,
       ${effectiveOrderCountFilter(effectiveOrderJobCompletionLiveExpression())} as job_completion_live,
       ${effectiveOrderCountFilter(effectiveOrderJobCompletionPeriodOverExpression())} as job_completion_period_over,
	       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodValidExpression())} as delivery_period_valid,
	       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodExpiredExpression())} as delivery_period_expired,
	       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodExtendedExpression())} as delivery_period_extended,
	       ${effectiveOrderCountFilter(effectiveOrderIrPreparationPendingExpression())} as ir_preparation_pending,
	       ${effectiveOrderCountFilter(effectiveOrderIrReceiptPendingExpression())} as ir_receipt_pending,
	       ${effectiveOrderCountFilter(effectiveOrderIrCompletedExpression())} as ir_completed
     from files f
     left join divisions d on d.id = f.division_id
     ${statusWhereSql}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);
  return {
    milestoneRows: statusMilestoneDefinitions.map((milestone, index) => {
      const prefix = `milestone_${index}`;
      const base = {
        key: milestone.key,
        total: readCount(`${prefix}_total`),
        underProcess: readCount(`${prefix}_under_process`),
        active: readCount(`${prefix}_active`),
        pending: readCount(`${prefix}_pending`),
        reviewed: readCount(`${prefix}_reviewed`),
        cleared: readCount(`${prefix}_cleared`),
      };
      if (milestone.key === "supplyOrder") {
        return {
          ...base,
          total: readCount("order_supply_order_total"),
          underProcess: readCount("order_financial_sanction_pending"),
          pending: readCount("order_supply_order_pending"),
          cleared: readCount("order_supply_order_placed"),
        };
      }
      if (milestone.key === "financialSanction") {
        const financialSanctionPending = readCount("order_financial_sanction_pending");
        const financialSanctionCompleted = readCount("order_financial_sanction_completed");
        const financialSanctionPreviousStage = readCount("order_financial_sanction_previous_stage");
        return {
          ...base,
          total: financialSanctionCompleted + financialSanctionPending,
          underProcess: financialSanctionPreviousStage,
          active: financialSanctionPending,
          pending: financialSanctionPending,
          reviewed: 0,
          cleared: financialSanctionCompleted,
        };
      }
      if (isBgStatusKey(milestone.key)) {
        return {
          ...base,
          bgExpired: readCount(`${prefix}_bg_expired`),
          bgToBeReturned: readCount(`${prefix}_bg_to_be_returned`),
        };
      }
      if (milestone.key === "payment") {
        return {
          ...base,
          total: readCount("order_payment_completed") + readCount("order_payment_pending"),
          pending: readCount("order_payment_pending"),
          cleared: readCount("order_payment_completed"),
        };
      }
      return base;
    }),
    liveBids: readCount("live_bids"),
    overdueBids: readCount("overdue_bids"),
    inProcessBids: readCount("in_process_bids"),
    liveSupplyOrders: readCount("live_supply_orders"),
    financialSanctionPending: readCount("order_financial_sanction_pending"),
    financialSanctionCompleted: readCount("order_financial_sanction_completed"),
    deliveryCompleted: readCount("delivery_completed"),
    deliveryDue: readCount("delivery_due"),
    deliveryOverdue: readCount("delivery_overdue"),
    jobCompletionCompleted: readCount("job_completion_completed"),
    jobCompletionLive: readCount("job_completion_live"),
    jobCompletionPeriodOver: readCount("job_completion_period_over"),
    deliveryPeriodValid: readCount("delivery_period_valid"),
    deliveryPeriodExpired: readCount("delivery_period_expired"),
    deliveryPeriodExtended: readCount("delivery_period_extended"),
    irPreparationPending: readCount("ir_preparation_pending"),
    irReceiptPending: readCount("ir_receipt_pending"),
    irCompleted: readCount("ir_completed"),
  };
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function warnIfSimpleCountsDiffer(
  reference: SimpleDashboardCounts,
  candidate: SimpleDashboardCounts,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL simple counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function warnIfFinanceTotalsDiffer(reference: FinanceTotals, candidate: FinanceTotals) {
  if (stableJson(roundedFinanceTotals(reference)) === stableJson(roundedFinanceTotals(candidate))) {
    return;
  }
  console.warn("Dashboard SQL finance totals differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function warnIfMiscellaneousCountsDiffer(
  reference: MiscellaneousCounts,
  candidate: MiscellaneousCounts,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL miscellaneous counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function getStatusCountsFromFlow(statusFlow: Array<Record<string, unknown>>): StatusCounts {
  const findRow = (key: string) => statusFlow.find((row) => row.key === key) ?? {};
  const bidding = findRow("bidding");
  const financialSanction = findRow("financialSanction");
  const supplyOrder = findRow("supplyOrder");
  const delivery = findRow("delivery");
  const jobCompletion = findRow("jobCompletion");
  const ir = findRow("ir");
  const deliveryPeriod = findRow("deliveryPeriod");
  const readCount = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
  return {
    milestoneRows: statusMilestoneDefinitions.map((milestone) => {
      const row = findRow(milestone.key);
      return {
        key: milestone.key,
        total: readCount(row, "total"),
        underProcess: readCount(row, "underProcess"),
        active: readCount(row, "active"),
        pending: readCount(row, "pending"),
        reviewed: readCount(row, "reviewed"),
        cleared: readCount(row, "cleared"),
      };
    }),
    liveBids: readCount(bidding, "liveBids"),
    overdueBids: readCount(bidding, "overdueBids"),
    inProcessBids: readCount(bidding, "inProcessBids"),
    liveSupplyOrders: readCount(supplyOrder, "liveSupplyOrders"),
    financialSanctionPending: readCount(financialSanction, "financialSanctionPending"),
    financialSanctionCompleted: readCount(financialSanction, "financialSanctionCompleted"),
    deliveryCompleted: readCount(delivery, "completed"),
    deliveryDue: readCount(delivery, "due"),
    deliveryOverdue: readCount(delivery, "overdue"),
    jobCompletionCompleted: readCount(jobCompletion, "jobCompleted"),
    jobCompletionLive: readCount(jobCompletion, "jobLive"),
    jobCompletionPeriodOver: readCount(jobCompletion, "jobPeriodOver"),
    deliveryPeriodValid: readCount(deliveryPeriod, "valid"),
    deliveryPeriodExpired: readCount(deliveryPeriod, "expired"),
    deliveryPeriodExtended: readCount(deliveryPeriod, "extended"),
    irPreparationPending: readCount(ir, "irPreparationPending"),
    irReceiptPending: readCount(ir, "irReceiptPending"),
    irCompleted: readCount(ir, "irCompleted"),
  };
}

function mergeStatusCountsIntoFlow<T extends Array<Record<string, unknown>>>(
  statusFlow: T,
  counts: StatusCounts,
) {
  const milestoneCountByKey = new Map(counts.milestoneRows.map((row) => [row.key, row]));
  return statusFlow.map((row) => {
    const milestoneCounts =
      typeof row.key === "string" ? milestoneCountByKey.get(row.key) : undefined;
    const baseRow = milestoneCounts
      ? {
          ...row,
          total: milestoneCounts.total,
          underProcess: milestoneCounts.underProcess,
          active: milestoneCounts.active,
          pending: milestoneCounts.pending,
          reviewed: milestoneCounts.reviewed,
          cleared: milestoneCounts.cleared,
        }
      : row;
    if (row.key === "bidding") {
      return {
        ...baseRow,
        liveBids: counts.liveBids,
        overdueBids: counts.overdueBids,
        inProcessBids: counts.inProcessBids,
      };
    }
    if (row.key === "supplyOrder") {
      return { ...baseRow, liveSupplyOrders: counts.liveSupplyOrders };
    }
    if (row.key === "financialSanction") {
      return {
        ...baseRow,
        total: counts.financialSanctionCompleted + counts.financialSanctionPending,
        underProcess: milestoneCounts?.underProcess ?? 0,
        active: counts.financialSanctionPending,
        pending: counts.financialSanctionPending,
        reviewed: 0,
        cleared: counts.financialSanctionCompleted,
        financialSanctionPending: counts.financialSanctionPending,
        financialSanctionCompleted: counts.financialSanctionCompleted,
      };
    }
    if (row.key === "delivery") {
      return {
        ...baseRow,
        completed: counts.deliveryCompleted,
        due: counts.deliveryDue,
        overdue: counts.deliveryOverdue,
      };
    }
    if (row.key === "jobCompletion") {
      return {
        ...baseRow,
        jobCompleted: counts.jobCompletionCompleted,
        jobLive: counts.jobCompletionLive,
        jobPeriodOver: counts.jobCompletionPeriodOver,
      };
    }
    if (row.key === "deliveryPeriod") {
      return {
        ...baseRow,
        valid: counts.deliveryPeriodValid,
        expired: counts.deliveryPeriodExpired,
        extended: counts.deliveryPeriodExtended,
      };
    }
    if (row.key === "ir") {
      return {
        ...baseRow,
        irPreparationPending: counts.irPreparationPending,
        irReceiptPending: counts.irReceiptPending,
        irCompleted: counts.irCompleted,
      };
    }
    return baseRow;
  });
}

function warnIfStatusCountsDiffer(reference: StatusCounts, candidate: StatusCounts) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL status counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function getStatusMilestonePresentation(key: string) {
  if (
    key === "highValue" ||
    key === "tcec" ||
    key === "ad" ||
    key === "rqa" ||
    key === "ifa" ||
    key === "postTcec" ||
    key === "refloatBidding" ||
    key === "refloatPostTcec" ||
    key === "cnc"
  ) {
    return { totalLabel: "Total cases", completedLabel: "Completed" };
  }
  if (key === "supplyOrder") {
    return { totalLabel: "Total files", completedLabel: "Placed" };
  }
  if (isBgStatusKey(key)) {
    return { totalLabel: "Total files", completedLabel: "Received" };
  }
  return { totalLabel: "Total files", completedLabel: "Completed" };
}

function buildStatusFlowFromSql(counts: StatusCounts) {
  const milestoneCounts = new Map(counts.milestoneRows.map((row) => [row.key, row]));
  const milestoneRows = statusMilestoneDefinitions.map((milestone) => {
    const row = milestoneCounts.get(milestone.key);
    const presentation = getStatusMilestonePresentation(milestone.key);
    const base = {
      key: milestone.key,
      label: milestone.label,
      completedLabel: presentation.completedLabel,
      totalLabel: presentation.totalLabel,
      pendingLabel: milestone.key === "refloatBidding" ? "In progress" : "Pending",
      total: row?.total ?? 0,
      underProcess: row?.underProcess ?? 0,
      active: row?.active ?? 0,
      pending: row?.pending ?? 0,
      reviewed: row?.reviewed ?? 0,
      hasReviewed: "reviewedColumn" in milestone && Boolean(milestone.reviewedColumn),
      cleared: row?.cleared ?? 0,
      activeLabel: milestone.key === "refloatBidding" ? "In progress" : "In process",
    };
    if (milestone.key === "bidding") {
      return {
        ...base,
        liveBids: counts.liveBids,
        overdueBids: counts.overdueBids,
        inProcessBids: counts.inProcessBids,
      };
    }
    if (milestone.key === "supplyOrder") {
      return {
        ...base,
        liveSupplyOrders: counts.liveSupplyOrders,
        financialSanctionPending: counts.financialSanctionPending,
        financialSanctionCompleted: counts.financialSanctionCompleted,
      };
    }
    return base;
  });
  const supplyOrderIndex = milestoneRows.findIndex((row) => row.key === "supplyOrder");
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period / Milestone",
    valid: counts.deliveryPeriodValid,
    expired: counts.deliveryPeriodExpired,
    extended: counts.deliveryPeriodExtended,
  };
  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...milestoneRows, deliveryPeriod]
      : [
          ...milestoneRows.slice(0, supplyOrderIndex + 1),
          deliveryPeriod,
          ...milestoneRows.slice(supplyOrderIndex + 1),
        ];
  const jobCompletion = {
    key: "jobCompletion",
    label: "Job Completion",
    jobCompleted: counts.jobCompletionCompleted,
    jobLive: counts.jobCompletionLive,
    jobPeriodOver: counts.jobCompletionPeriodOver,
  };
  const ir = {
    key: "ir",
    label: "IR",
    irPreparationPending: counts.irPreparationPending,
    irReceiptPending: counts.irReceiptPending,
    irCompleted: counts.irCompleted,
  };
  const paymentIndex = withDeliveryPeriod.findIndex((row) => row.key === "payment");
  return paymentIndex === -1
    ? [...withDeliveryPeriod, jobCompletion, ir]
    : [
        ...withDeliveryPeriod.slice(0, paymentIndex),
        jobCompletion,
        ir,
        ...withDeliveryPeriod.slice(paymentIndex),
      ];
}

function getAnalyticsSqlSlice(analytics: AnalyticsSqlSlice): AnalyticsSqlSlice {
  return {
    divisionFileRanking: analytics.divisionFileRanking,
    divisionValueRanking: analytics.divisionValueRanking,
    divisionTurnaroundRanking: analytics.divisionTurnaroundRanking,
    topFirmSupplyOrders: analytics.topFirmSupplyOrders,
    topIndentorsByFiles: analytics.topIndentorsByFiles,
    topIndentorsByValue: analytics.topIndentorsByValue,
    milestoneClearingRanking: analytics.milestoneClearingRanking,
    monthlyFileInflow: analytics.monthlyFileInflow,
    monthWiseSupplyOrder: analytics.monthWiseSupplyOrder,
    monthWiseDeliverySchedule: analytics.monthWiseDeliverySchedule,
    biddingModeMix: analytics.biddingModeMix,
    fileValueThresholds: analytics.fileValueThresholds,
    soValueThresholds: analytics.soValueThresholds,
    divisionRiskRanking: analytics.divisionRiskRanking,
    divisionPaymentPendingRanking: analytics.divisionPaymentPendingRanking,
  };
}

function warnIfAnalyticsSqlSliceDiffers(
  label: string,
  reference: AnalyticsSqlSlice,
  candidate: AnalyticsSqlSlice,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn(`Dashboard SQL ${label} analytics differ from TypeScript summary.`, {
    reference,
    candidate,
  });
}

function mergeAnalyticsSqlSlice<T extends AnalyticsSqlSlice>(
  analytics: T,
  slice: AnalyticsSqlSlice,
) {
  return {
    ...analytics,
    divisionFileRanking: slice.divisionFileRanking,
    divisionValueRanking: slice.divisionValueRanking,
    divisionTurnaroundRanking: slice.divisionTurnaroundRanking,
    topFirmSupplyOrders: slice.topFirmSupplyOrders,
    topIndentorsByFiles: slice.topIndentorsByFiles,
    topIndentorsByValue: slice.topIndentorsByValue,
    milestoneClearingRanking: slice.milestoneClearingRanking,
    monthlyFileInflow: slice.monthlyFileInflow,
    monthWiseSupplyOrder: slice.monthWiseSupplyOrder,
    monthWiseDeliverySchedule: slice.monthWiseDeliverySchedule,
    biddingModeMix: slice.biddingModeMix,
    fileValueThresholds: slice.fileValueThresholds,
    soValueThresholds: slice.soValueThresholds,
    divisionRiskRanking: slice.divisionRiskRanking,
    divisionPaymentPendingRanking: slice.divisionPaymentPendingRanking,
  };
}

function warnIfManualMilestoneSqlSliceDiffers(
  reference: ManualMilestoneSqlSlice,
  candidate: ManualMilestoneSqlSlice,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL manual milestone flow differs from TypeScript summary.", {
    reference,
    candidate,
  });
}

async function verifyCurrentUserPassword(userId: string, password: string) {
  const result = await pool.query<{ ok: boolean | null }>(
    `select password_hash = crypt($2, password_hash) as ok
     from app_users
     where id = $1
       and is_active = true
       and password_hash is not null`,
    [userId, password],
  );
  if (!result.rows[0]?.ok) throw new HttpError(403, "Incorrect password.");
}

dashboardRouter.get(
  "/suspected-anomalies/acceptances",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensureAnomalyGovernanceSchema();
    const result = await pool.query<{
      signature: string;
      reason: string | null;
      rule_key: string | null;
      file_id: string | null;
      file_ref: string | null;
      status: string;
      scope: string;
      requested_by_name: string | null;
      requested_at: string;
      accepted_by_name: string | null;
      accepted_at: string;
      reviewed_by_name: string | null;
      reviewed_at: string | null;
      revoked_by_name: string | null;
      revoked_at: string | null;
      admin_message: string | null;
    }>(
      `select a.signature, a.reason, a.rule_key, a.file_id,
              coalesce(nullif(f.unique_code, ''), nullif(f.file_no, ''), nullif(f.title, ''), a.file_id) as file_ref,
              a.status, a.scope, a.requested_by_name,
              a.requested_at, a.accepted_by_name, a.accepted_at, a.reviewed_by_name, a.reviewed_at,
              a.revoked_by_name, a.revoked_at, a.admin_message
       from suspected_anomaly_acceptances a
       left join files f on f.id::text = a.file_id
       where (
         $1::boolean = true
         and (a.status = 'pending' or a.admin_history_cleared_at is null)
       )
       or (
         $1::boolean = false
         and not ($2::uuid = any(a.history_hidden_by_user_ids))
         and a.requested_by_user_id = $2
       )
       order by a.requested_at desc`,
      [hasAnomalyGovernanceReadAccess(user), user.id],
    );
    response.json({
      acceptances: result.rows.map((row) => ({
        signature: row.signature,
        reason: fromDbText(row.reason),
        ruleKey: fromDbText(row.rule_key) || parseAnomalySignature(row.signature).ruleKey,
        ruleLabel: parseAnomalySignature(row.signature).ruleLabel,
        previousField: parseAnomalySignature(row.signature).previousField,
        previousValue: parseAnomalySignature(row.signature).previousValue,
        laterField: parseAnomalySignature(row.signature).laterField,
        laterValue: parseAnomalySignature(row.signature).laterValue,
        context: parseAnomalySignature(row.signature).context,
        fileId: fromDbText(row.file_id),
        fileRef: fromDbText(row.file_ref),
        status: row.status,
        scope: row.scope,
        requestedByName: fromDbText(row.requested_by_name),
        requestedAt: row.requested_at,
        acceptedByName: fromDbText(row.accepted_by_name),
        acceptedAt: row.accepted_at,
        reviewedByName: fromDbText(row.reviewed_by_name),
        reviewedAt: row.reviewed_at ?? undefined,
        revokedByName: fromDbText(row.revoked_by_name),
        revokedAt: row.revoked_at ?? undefined,
        adminMessage: fromDbText(row.admin_message),
      })),
    });
  }),
);

dashboardRouter.post(
  "/suspected-anomalies/acceptances/clear-history",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensureAnomalyGovernanceSchema();
    const body = request.body as { password?: unknown; signatures?: unknown };
    const password = readString(body.password)?.trim() ?? "";
    if (!password) throw new HttpError(400, "Password is required.");
    const signatures = Array.isArray(body.signatures)
      ? body.signatures.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    if (!signatures.length) throw new HttpError(400, "Select at least one anomaly to clear.");
    await verifyCurrentUserPassword(user.id, password);
    if (hasAnomalyAdminAccess(user)) {
      await pool.query(
        `delete from suspected_anomaly_acceptances
         where status in ('rejected', 'revoked')
           and signature = any($1::text[])`,
        [signatures],
      );
    } else {
      await pool.query(
        `delete from suspected_anomaly_acceptances
         where status in ('rejected', 'revoked')
           and signature = any($1::text[])
           and requested_by_user_id = $2`,
        [signatures, user.id],
      );
    }
    clearDashboardReportCaches();
    response.json({ ok: true });
  }),
);

dashboardRouter.post(
  "/suspected-anomalies/acceptances",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role === "viewer") throw new HttpError(403, "Viewer cannot accept anomalies.");
    await ensureAnomalyGovernanceSchema();
    const body = request.body as { signature?: unknown; reason?: unknown };
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!signature) throw new HttpError(400, "Anomaly signature is required.");
    if (!reason) throw new HttpError(400, "Reason is required to accept an anomaly.");
    const parsedSignature = parseAnomalySignature(signature);
    await pool.query(
      `insert into suspected_anomaly_acceptances
         (signature, reason, rule_key, file_id, status, scope, requested_by_user_id,
          requested_by_name, requested_at, accepted_by_user_id, accepted_by_name, accepted_at)
       values ($1, $2, $3, $4, 'pending', 'file', $5, $6, now(), $5, $6, now())
       on conflict (signature) do update set
         reason = excluded.reason,
         rule_key = excluded.rule_key,
         file_id = excluded.file_id,
         status = 'pending',
         scope = 'file',
         requested_by_user_id = excluded.requested_by_user_id,
         requested_by_name = excluded.requested_by_name,
         requested_at = now(),
         accepted_by_user_id = excluded.accepted_by_user_id,
         accepted_by_name = excluded.accepted_by_name,
         accepted_at = now(),
         reviewed_by_user_id = null,
         reviewed_by_name = null,
         reviewed_at = null,
         admin_message = null,
         history_hidden_by_user_ids = '{}',
         admin_history_cleared_at = null,
         admin_history_cleared_by_user_id = null,
         admin_history_cleared_by_name = null,
         revoked_by_user_id = null,
         revoked_by_name = null,
         revoked_at = null`,
      [signature, reason, parsedSignature.ruleKey, parsedSignature.fileId, user.id, user.name],
    );
    clearDashboardReportCaches();
    response.json({ ok: true });
  }),
);

dashboardRouter.post(
  "/suspected-anomalies/acceptances/review",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!hasAnomalyAdminAccess(user)) throw new HttpError(403, "Only admin can review anomalies.");
    await ensureAnomalyGovernanceSchema();
    const body = request.body as { signature?: unknown; action?: unknown; adminMessage?: unknown };
    const signature = readString(body.signature)?.trim() ?? "";
    const action = readString(body.action)?.trim() ?? "";
    const adminMessage = readString(body.adminMessage)?.trim() ?? "";
    const next =
      action === "approve_file"
        ? { status: "approved_file", scope: "file" }
        : action === "approve_universal"
          ? { status: "approved_universal", scope: "universal" }
          : action === "reject"
            ? { status: "rejected", scope: "file" }
            : action === "revoke"
              ? { status: "revoked", scope: "file" }
              : undefined;
    if (!signature) throw new HttpError(400, "Anomaly signature is required.");
    if (!next) throw new HttpError(400, "Review action is invalid.");
    if (action === "reject" && !adminMessage) {
      throw new HttpError(400, "Admin message is required when rejecting an anomaly request.");
    }
    const parsedSignature = parseAnomalySignature(signature);
    let result = await pool.query(
      `update suspected_anomaly_acceptances
       set status = $2::text,
           scope = $3::text,
           reviewed_by_user_id = $4,
           reviewed_by_name = $5,
           reviewed_at = now(),
           admin_message = nullif($6::text, ''),
           history_hidden_by_user_ids = '{}',
           admin_history_cleared_at = null,
           admin_history_cleared_by_user_id = null,
           admin_history_cleared_by_name = null,
           revoked_by_user_id = case when $2::text = 'revoked' then $4 else revoked_by_user_id end,
           revoked_by_name = case when $2::text = 'revoked' then $5 else revoked_by_name end,
           revoked_at = case when $2::text = 'revoked' then now() else revoked_at end
       where signature = $1::text`,
      [signature, next.status, next.scope, user.id, user.name, adminMessage],
    );
    if (
      result.rowCount === 0 &&
      (action === "approve_file" || action === "approve_universal" || action === "reject")
    ) {
      result = await pool.query(
        `insert into suspected_anomaly_acceptances
           (signature, reason, rule_key, file_id, status, scope, requested_by_user_id,
            requested_by_name, requested_at, accepted_by_user_id, accepted_by_name, accepted_at,
            reviewed_by_user_id, reviewed_by_name, reviewed_at, admin_message)
         values ($1, 'Admin direct action', $2, $3, $4, $5, $6, $7, now(), $6, $7, now(), $6, $7, now(), nullif($8::text, ''))
         on conflict (signature) do update set
           status = excluded.status,
           scope = excluded.scope,
           reviewed_by_user_id = excluded.reviewed_by_user_id,
           reviewed_by_name = excluded.reviewed_by_name,
           reviewed_at = now(),
           admin_message = excluded.admin_message,
           history_hidden_by_user_ids = '{}',
           admin_history_cleared_at = null,
           admin_history_cleared_by_user_id = null,
           admin_history_cleared_by_name = null`,
        [
          signature,
          parsedSignature.ruleKey,
          parsedSignature.fileId,
          next.status,
          next.scope,
          user.id,
          user.name,
          adminMessage,
        ],
      );
    }
    if (result.rowCount === 0) throw new HttpError(404, "Anomaly exception request not found.");
    clearDashboardReportCaches();
    response.json({ ok: true });
  }),
);

dashboardRouter.get(
  "/suspected-anomalies/rules",
  asyncHandler(async (request, response) => {
    requireAuth(request as AuthRequest);
    const rules = await loadCustomAnomalyRules();
    response.json({ rules, fields: customAnomalyFieldDefinitions });
  }),
);

dashboardRouter.post(
  "/suspected-anomalies/rules",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!hasAnomalyAdminAccess(user))
      throw new HttpError(403, "Only admin can create anomaly rules.");
    await ensureAnomalyGovernanceSchema();
    const input = validateCustomAnomalyRuleInput(request.body as Record<string, unknown>);
    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      rule_type: string;
      field_a: string;
      operator: string;
      field_b: string | null;
      fixed_value: string | null;
      threshold_days: number | null;
      severity: string;
      scope: string;
      enabled: boolean;
      created_by_name: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `insert into anomaly_rules
         (name, description, rule_type, field_a, operator, field_b, fixed_value, threshold_days,
          severity, scope, enabled, created_by_user_id, created_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id, name, description, rule_type, field_a, operator, field_b,
                 fixed_value, threshold_days, severity, scope, enabled, created_by_name, created_at, updated_at`,
      [
        input.name,
        input.description,
        input.ruleType,
        input.fieldA,
        input.operator,
        input.fieldB,
        input.fixedValue ?? null,
        input.thresholdDays ?? null,
        input.severity,
        input.scope,
        input.enabled,
        user.id,
        user.name,
      ],
    );
    clearDashboardReportCaches();
    response.json({ rule: mapCustomAnomalyRule(result.rows[0]) });
  }),
);

dashboardRouter.patch(
  "/suspected-anomalies/rules/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!hasAnomalyAdminAccess(user))
      throw new HttpError(403, "Only admin can update anomaly rules.");
    await ensureAnomalyGovernanceSchema();
    const id = request.params.id;
    const enabled = (request.body as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") throw new HttpError(400, "Enabled flag is required.");
    const result = await pool.query(
      `update anomaly_rules set enabled = $2::boolean, updated_at = now() where id = $1::uuid`,
      [id, enabled],
    );
    if (result.rowCount === 0) throw new HttpError(404, "Anomaly rule not found.");
    clearDashboardReportCaches();
    response.json({ ok: true });
  }),
);

dashboardRouter.get(
  "/suspected-anomalies",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensureSupplyOrderBillReturnsSchema();
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const divisionYear =
      selectedYear === allActiveFilesYear || selectedYear === activePlusCurrentFyClosedYear
        ? settings.financialYear
        : selectedYear;
    const divisions = await loadDivisions(user, divisionYear);
    const requestedDivision = readString(request.query.division) ?? "all";
    const requestedAnalyticsDivision = readString(request.query.analyticsDivision) ?? "all";
    const fileCategories = normalizeFileCategories(readList(request.query.fileCategories));
    const activeDivision =
      requestedDivision === "all" || divisions.some((item) => item.name === requestedDivision)
        ? requestedDivision
        : "all";
    const activeAnalyticsDivision =
      requestedAnalyticsDivision === "all" ||
      divisions.some((item) => item.name === requestedAnalyticsDivision)
        ? requestedAnalyticsDivision
        : "all";
    const dashboardFileWhere = getDashboardFileWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear,
      currentFinancialYear: settings.financialYear,
      activeDivision,
      activeAnalyticsDivision,
      fileCategories,
    });
    await ensureAnomalyGovernanceSchema();
    const [filesResult, acceptanceResult, customRules] = await Promise.all([
      loadFiles(dashboardFileWhere.whereSql, dashboardFileWhere.values),
      pool.query<{
        signature: string;
        rule_key: string | null;
        status: string;
        scope: string;
        reason: string | null;
        admin_message: string | null;
        requested_by_user_id: string | null;
        requested_by_name: string | null;
        requested_at: string | null;
        reviewed_by_name: string | null;
        reviewed_at: string | null;
      }>(
        `select signature, rule_key, status, scope, reason, admin_message, requested_by_user_id,
                requested_by_name, requested_at, reviewed_by_name, reviewed_at
         from suspected_anomaly_acceptances
         where status in ('pending', 'approved_file', 'approved_universal', 'rejected', 'revoked')`,
      ),
      loadCustomAnomalyRules(),
    ]);
    const canViewAllAnomalyGovernance = hasAnomalyGovernanceReadAccess(user);
    const visibleStateRows = acceptanceResult.rows.filter(
      (row) =>
        row.status === "approved_file" ||
        row.status === "approved_universal" ||
        canViewAllAnomalyGovernance ||
        row.requested_by_user_id === user.id,
    );
    const acceptanceBySignature = new Map(
      visibleStateRows.map((row) => [
        row.signature,
        {
          status: row.status,
          scope: row.scope,
          reason: fromDbText(row.reason),
          adminMessage: fromDbText(row.admin_message),
          requestedByName: fromDbText(row.requested_by_name),
          requestedAt: row.requested_at ?? undefined,
          reviewedByName: fromDbText(row.reviewed_by_name),
          reviewedAt: row.reviewed_at ?? undefined,
        },
      ]),
    );
    const suppressions = {
      signatures: new Set(
        acceptanceResult.rows
          .filter((row) => row.status === "approved_file")
          .map((row) => row.signature),
      ),
      universalRuleKeys: new Set(
        acceptanceResult.rows
          .filter((row) => row.status === "approved_universal" && row.rule_key)
          .map((row) => row.rule_key!),
      ),
    };
    const rows = getSuspectedAnomalyRows(
      filesResult.filter((file) => matchesFileCategorySelection(file, fileCategories)),
      suppressions,
      customRules,
    ).map((row) => {
      const acceptance = acceptanceBySignature.get(row.signature);
      if (!acceptance) return row;
      return {
        ...row,
        requestStatus: acceptance.status,
        userExplanation: acceptance.reason,
        adminMessage: acceptance.adminMessage,
        requestedByName: acceptance.requestedByName,
        requestedAt: acceptance.requestedAt,
        reviewedByName: acceptance.reviewedByName,
        reviewedAt: acceptance.reviewedAt,
        scope: acceptance.scope,
      };
    });
    response.json({ rows });
  }),
);

dashboardRouter.get(
  "/monthwise-delivery-schedule",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensureSupplyOrderBillReturnsSchema();
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const divisionYear =
      selectedYear === allActiveFilesYear || selectedYear === activePlusCurrentFyClosedYear
        ? settings.financialYear
        : selectedYear;
    const divisions = await loadDivisions(user, divisionYear);
    const requestedDivision = readString(request.query.division) ?? "all";
    const requestedAnalyticsDivision = readString(request.query.analyticsDivision) ?? "all";
    const fileCategories = normalizeFileCategories(readList(request.query.fileCategories));
    const activeDivision =
      requestedDivision === "all" || divisions.some((item) => item.name === requestedDivision)
        ? requestedDivision
        : "all";
    const activeAnalyticsDivision =
      requestedAnalyticsDivision === "all" ||
      divisions.some((item) => item.name === requestedAnalyticsDivision)
        ? requestedAnalyticsDivision
        : "all";
    const dashboardFileWhere = getDashboardFileWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear,
      currentFinancialYear: settings.financialYear,
      activeDivision,
      activeAnalyticsDivision,
      fileCategories,
    });

    response.json({
      rows: await loadMonthWiseDeliveryScheduleRows({
        whereSql: dashboardFileWhere.whereSql,
        values: dashboardFileWhere.values,
      }),
    });
  }),
);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const divisionYear =
      selectedYear === allActiveFilesYear || selectedYear === activePlusCurrentFyClosedYear
        ? settings.financialYear
        : selectedYear;
    const [valueThresholdLevels, divisions] = await Promise.all([
      divisionYear ? loadValueThresholdLevels(divisionYear) : [],
      loadDivisions(user, divisionYear),
    ]);
    const requestedDivision = readString(request.query.division) ?? "all";
    const requestedAnalyticsDivision = readString(request.query.analyticsDivision) ?? "all";
    const fileCategories = normalizeFileCategories(readList(request.query.fileCategories));
    const activeDivision =
      requestedDivision === "all" || divisions.some((item) => item.name === requestedDivision)
        ? requestedDivision
        : "all";
    const activeAnalyticsDivision =
      requestedAnalyticsDivision === "all" ||
      divisions.some((item) => item.name === requestedAnalyticsDivision)
        ? requestedAnalyticsDivision
        : "all";
    const dashboardFileWhere = getDashboardFileWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear,
      currentFinancialYear: settings.financialYear,
      activeDivision,
      activeAnalyticsDivision,
      fileCategories,
    });
    const financeFileWhere = getDashboardFileWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear: undefined,
      currentFinancialYear: settings.financialYear,
      activeDivision,
      activeAnalyticsDivision,
      fileCategories,
    });
    const dashboardDivisions =
      activeDivision === "all"
        ? divisions
        : divisions.filter((division) => division.name === activeDivision);
    const analyticsSliceDivision = activeDivision;
    const divisionFilteredSliceDivision =
      activeAnalyticsDivision === "all" ? activeDivision : activeAnalyticsDivision;
    const divisionFilteredSliceDivisions =
      activeAnalyticsDivision === "all"
        ? dashboardDivisions
        : divisions.filter((division) => division.name === activeAnalyticsDivision);
    const liveMilestones = readList(request.query.liveMilestones);
    const cacheKey = `dashboard:summary:${JSON.stringify({
      version: 5,
      scope: getAuthScopeCacheKey(user),
      selectedYear,
      divisionYear,
      activeDivision,
      activeAnalyticsDivision,
      fileCategories,
      liveMilestones,
    })}`;
    const summary = await getCached(cacheKey, cacheTtl.dashboardSummaryMs, async () => {
      const [files, financeFiles] = await Promise.all([
        loadFiles(dashboardFileWhere.whereSql, dashboardFileWhere.values),
        loadFiles(financeFileWhere.whereSql, financeFileWhere.values),
      ]);
      const filteredFiles = files.filter((file) =>
        matchesFileCategorySelection(file, fileCategories),
      );
      const filteredFinanceFiles = financeFiles.filter((file) =>
        matchesFileCategorySelection(file, fileCategories),
      );
      const normalizedSummary = buildDashboardSummary({
        files: filteredFiles,
        financeFiles: filteredFinanceFiles,
        divisions,
        settings: { ...settings, valueThresholdLevels },
        division: activeDivision,
        analyticsDivision: activeAnalyticsDivision,
        liveMilestones,
      });

      if (process.env.DASHBOARD_SQL_COMPARE === "true") {
        const [
          sqlSimpleCounts,
          sqlFinanceTotals,
          sqlMiscellaneousCounts,
          sqlStatusCounts,
          sqlAnalyticsSlice,
          sqlDivisionFilteredAnalyticsSlice,
          sqlManualMilestoneSlice,
        ] = await Promise.all([
          loadSimpleDashboardCounts({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            activeDivision,
            modes: settings.modes,
          }),
          loadFinanceTotals({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            activeDivision,
            dashboardDivisions,
          }),
          loadMiscellaneousCounts({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            activeDivision,
          }),
          loadStatusCounts({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            activeDivision,
          }),
          loadAnalyticsSqlSlice({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            divisionName: analyticsSliceDivision,
            divisions: dashboardDivisions,
            valueThresholdLevels,
          }),
          loadAnalyticsSqlSlice({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            divisionName: divisionFilteredSliceDivision,
            divisions: divisionFilteredSliceDivisions,
            valueThresholdLevels,
          }),
          loadManualMilestoneSqlSlice({
            whereSql: dashboardFileWhere.whereSql,
            values: dashboardFileWhere.values,
            activeDivision,
            divisions: dashboardDivisions,
            configuredMilestones: getConfiguredMilestones(settings.milestones),
            liveMilestones,
          }),
        ]);
        warnIfSimpleCountsDiffer(
          {
            dashboardFileCount: normalizedSummary.dashboardFileCount,
            modeCounts: normalizedSummary.modeCounts,
            gemBiddingModeCounts:
              normalizedSummary.gemBiddingModeCounts ??
              gemBiddingModeOptions.map((name) => ({ name, count: 0 })),
            topSummaryStats: normalizedSummary.topSummaryStats,
          },
          sqlSimpleCounts,
        );
        warnIfFinanceTotalsDiffer(normalizedSummary.financeTotals, sqlFinanceTotals);
        warnIfMiscellaneousCountsDiffer(
          normalizedSummary.miscellaneousCounts,
          sqlMiscellaneousCounts,
        );
        warnIfStatusCountsDiffer(
          getStatusCountsFromFlow(normalizedSummary.statusFlow),
          sqlStatusCounts,
        );
        warnIfAnalyticsSqlSliceDiffers(
          "dashboard",
          getAnalyticsSqlSlice(normalizedSummary.analytics),
          sqlAnalyticsSlice,
        );
        warnIfAnalyticsSqlSliceDiffers(
          "division-filtered",
          getAnalyticsSqlSlice(normalizedSummary.divisionFilteredAnalytics),
          sqlDivisionFilteredAnalyticsSlice,
        );
        warnIfManualMilestoneSqlSliceDiffers(
          {
            manualMilestoneFlow: normalizedSummary.manualMilestoneFlow,
            visibleLiveMilestoneNames: normalizedSummary.visibleLiveMilestoneNames,
            liveStatusRows: normalizedSummary.liveStatusRows,
          },
          sqlManualMilestoneSlice,
        );
      }

      return normalizedSummary;
    });

    response.json({ summary });
  }),
);
