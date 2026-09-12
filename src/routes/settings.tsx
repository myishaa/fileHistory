import { createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Info,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  createMasterFirm,
  deleteMasterFirm,
  fetchFilesForYear,
  fetchIndentors,
  fetchMasterFirms,
  listArchivedMasterFirms,
  permanentlyDeleteArchivedMasterFirm,
  restoreArchivedMasterFirm,
  store,
  updateMasterFirm,
  useActiveUser,
  useDivisions,
  useSettings,
  useUsers,
  type AppUser,
  type AppUserRole,
  type Division,
  type DemandProcessingDayRange,
  type FileRecord,
  type FirmRatingConfig,
  type Indentor,
  type IpAccessConfig,
  type IpAccessMode,
  type IpLoginAttempt,
  type MasterFirm,
  type SpecialFileMarker,
  type TrustedIpAddress,
  type UniversalViewerCashOutgoEditScope,
  type ValueThresholdAppliesTo,
  type ValueThresholdLevel,
} from "@/lib/files-store";
import { getMmgSummaryFieldOptions, normalizeMmgSummaryFields } from "@/lib/mmg-summary";
import {
  getDemandProcessingField,
  getDemandProcessingFieldGroups,
  normalizeDemandProcessingPresets,
  type DemandProcessingPreset,
} from "@/lib/demand-processing-analysis";
import { tableFieldPresetGroups, type TableFieldPreset } from "@/lib/table-field-presets";
import { promptDeletionPassword, requestDeletionPassword } from "@/lib/delete-password";
import {
  fileCategoryOptions,
  getAllFileCategoryKeys,
  getFileCategoryOptions,
  type FileCategoryKey,
  type FileCategoryOption,
} from "@/lib/file-categories";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { YearSetupPanel } from "@/routes/year-setup";
import {
  ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
  displayFinancialYearLabel,
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isAllFilesYear,
  normalizeMilestoneName,
} from "@/lib/year-filter";
import { defaultFirmRatingFields, normalizeFirmRatingConfig } from "@/lib/firm-rating";
import {
  addEditRibbonFieldOptions,
  defaultAddEditRibbonFields,
  normalizeAddEditRibbonFields,
  type AddEditRibbonFieldKey,
} from "@/lib/add-edit-ribbon-fields";
import {
  fileTypeGroupOptions,
  getDefaultFileTypeGroup,
  normalizeFileTypeGroups,
  type FileTypeGroup,
  type FileTypeGroupSetting,
} from "@/lib/file-type-groups";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const defaultMilestoneSequence = [
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
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "Bill sent for payment",
  "Payment",
  "File Closed",
];
const defaultFirmTypes = ["MSE", "MSE (Women)", "Non-MSE"];
const defaultFileTypes = ["Goods & Services", "AMC", "MPC", "CARS", "O&M"];
const defaultModes = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const allFileCategoryKeys = fileCategoryOptions.map((option) => option.key);
const fileClosedMilestone = "File Closed";
const settingsPageSizeOptions = [25, 50, 100] as const;

function appendFileClosedMilestone(milestones: string[]) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const normalizedMilestones = milestones.map(normalizeConfiguredMilestoneLabel);
  const withFinancialSanction = insertFinancialSanctionMilestone(normalizedMilestones);
  const withBillSent = insertBillSentMilestone(withFinancialSanction);
  const withoutFileClosed = withBillSent.filter(
    (milestone) => normalize(milestone) !== normalize(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function insertBillSentMilestone(milestones: string[]) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const hasBillSent = milestones.some((milestone) => normalize(milestone) === "billsentforpayment");
  const paymentIndex = milestones.findIndex((milestone) => normalize(milestone) === "payment");
  if (hasBillSent || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Bill sent for payment",
    ...milestones.slice(paymentIndex),
  ];
}

function insertFinancialSanctionMilestone(milestones: string[]) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const hasFinancialSanction = milestones.some(
    (milestone) => normalize(milestone) === "financialsanction",
  );
  const supplyOrderIndex = milestones.findIndex(
    (milestone) => normalize(milestone) === "supplyorder",
  );
  if (hasFinancialSanction || supplyOrderIndex === -1) return milestones;
  return [
    ...milestones.slice(0, supplyOrderIndex),
    "Financial Sanction",
    ...milestones.slice(supplyOrderIndex),
  ];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return milestone.trim().toLowerCase() === "controlled" ? "Controlling" : milestone;
}

function readFinancialYearStart(label: string) {
  const match = label.trim().match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  const expectedShortEnd = (startYear + 1) % 100;
  const actualShortEnd = match[2].length === 2 ? endYear : endYear % 100;
  return actualShortEnd === expectedShortEnd ? startYear : null;
}

function formatFinancialYear(startYear: number) {
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

function getNextFinancialYearLabel(years: string[]) {
  const latestStartYear = years.reduce<number | null>((latest, year) => {
    const startYear = readFinancialYearStart(year);
    if (startYear === null) return latest;
    return latest === null || startYear > latest ? startYear : latest;
  }, null);
  return formatFinancialYear((latestStartYear ?? new Date().getFullYear()) + 1);
}

function validateNewFinancialYearLabel(label: string, years: string[]) {
  if (!/^\d{4}-\d{2}$/.test(label)) {
    return "Financial year must be entered in YYYY-YY format, like 2026-27.";
  }
  const startYear = readFinancialYearStart(label);
  if (startYear === null) return "Financial year must be continuous, like 2026-27.";
  const existingStartYears = years
    .map(readFinancialYearStart)
    .filter((year): year is number => year !== null);
  if (existingStartYears.includes(startYear)) return `Financial year ${label} already exists.`;
  if (!existingStartYears.length) return "";
  const earliest = Math.min(...existingStartYears);
  const latest = Math.max(...existingStartYears);
  if (startYear === earliest - 1 || startYear === latest + 1) return "";
  return `Financial years must be continuous. Add ${formatFinancialYear(
    earliest - 1,
  )} or ${formatFinancialYear(latest + 1)} next.`;
}

type AdminSection = {
  key: string;
  label: string;
  helper: string[];
  content: ReactNode;
};

const adminSectionKeys = new Set([
  "user",
  "workspace",
  "yearSetup",
  "mmgSummary",
  "demandProcessing",
  "divisions",
  "indentors",
  "firms",
  "firmRating",
  "fileTypes",
  "modes",
  "firmTypes",
  "fileMarkers",
  "tcec",
  "thresholds",
  "anomalyGovernance",
  "milestones",
  "presets",
  "users",
  "ipAccess",
  "archive",
]);

const settingsSectionHelpers = {
  theme: [
    "Controls your personal display theme and tint.",
    "This does not change file data or workflow logic.",
  ],
  user: [
    "Shows your account, role, and assigned divisions.",
    "Some appearance settings here affect only your own view.",
  ],
  workspace: [
    "Controls global workspace defaults such as selected FY, available years, theme, and deletion password.",
    "Changes here can affect all users.",
  ],
  yearSetup: [
    "Choose the FY to prepare division allocations and other year-specific setup.",
    "Saved allocation values are used in dashboard value views and value reports for that FY.",
  ],
  mmgSummary: [
    "Controls which fields and labels appear in MMG Summary exports.",
    "This changes report display/export fields, not file records.",
  ],
  demandProcessing: [
    "Controls reusable Demand Processing Analysis presets.",
    "Preset From/To dates decide how demand-processing time is measured in reports.",
  ],
  divisions: [
    "Maintains division names, codes, AD flag, and division-level allocation context.",
    "Division changes affect filters, access, dashboards, and reports.",
  ],
  indentors: [
    "Maintains indentor master data and division mapping.",
    "This helps keep file entry, filters, and reports consistent.",
  ],
  firms: [
    "Maintains firm master data and the Firm Unique No. label.",
    "Firm data is used for search, firm analysis, and firm performance reports.",
  ],
  firmRating: [
    "Controls firm rating fields and maximum marks.",
    "These settings affect rating score calculation in firm performance views.",
  ],
  fileTypes: [
    "Controls available file types and their workflow group.",
    "Workflow group affects delivery, inspection, and payment behavior in the app.",
  ],
  modes: [
    "Controls available procurement modes such as OBM, PBM, SBM, LBM, and LPC.",
    "These modes appear in file entry, filters, analytics, and reports.",
  ],
  firmTypes: [
    "Controls firm type options such as MSE, MSE (Women), and Non-MSE.",
    "These options are used in S.O. firm details and firm-type reporting.",
  ],
  fileMarkers: [
    "Controls special marker codes that can be attached to files.",
    "Markers help tag and filter special cases.",
  ],
  tcec: [
    "Controls TCEC committee options.",
    "These options are used in TCEC fields, analytics, and reports.",
  ],
  thresholds: [
    "Controls value slabs used for count/value analysis.",
    "Thresholds can apply to demand value, S.O. value, or both.",
  ],
  anomalyGovernance: [
    "Shows suspected data issues and accepted/rejected anomaly decisions.",
    "Custom rules here can affect what appears in anomaly checks.",
  ],
  milestones: [
    "Controls the milestone sequence used for workflow tracking.",
    "Changing milestones can affect Status-2, Status-4, and related search focus behavior.",
  ],
  presets: [
    "Controls reusable Search table field presets.",
    "Presets change visible/exported columns, not which files are returned.",
  ],
  users: [
    "Controls authorised users, roles, division access, and file-category access.",
    "Access changes affect what each user can view or edit.",
  ],
  ipAccess: [
    "Controls login access by trusted IP address.",
    "Default mode is Off, so existing login behavior is unchanged unless Admin enables monitoring or restriction.",
    "Use Notify mode first to collect real IP addresses before switching to Restrict mode.",
    "Archived IP attempts can be permanently deleted with the configured deletion password.",
  ],
  archive: [
    "Shows archived files and permanent delete options.",
    "Permanent delete needs the configured deletion password.",
  ],
} satisfies Record<string, string[]>;

const workspaceYearHelpers = {
  setCurrent: [
    "Makes the chosen FY the software's official current FY.",
    "New files will use this year as the current FY.",
    "Global Active-files filter options will treat this FY as the current FY.",
    "Use this when the office has moved to a new financial year.",
  ],
  lockSelection: [
    "When unlocked, new files can be added by selecting any of the two FYs options available on Add File page.",
    "When locked, new files can be added only to current FY.",
    "Use Unlocked during the FY transition period when it is permitted to raise demands for next FY in current FY itself.",
  ],
} satisfies Record<string, string[]>;

const deletionPasswordHelper = [
  "Required for deleting files, financial years, and permanently deleting archived records.",
  "Keep it known only to admins who are allowed to perform delete actions.",
  "Changing it applies to future delete confirmations.",
];

const settingsControlHelpers = {
  workspaceDelete: [
    "Deletes only the selected FY from workspace year options.",
    "Current FY and any FY having files cannot be deleted.",
    "This action needs the deletion password.",
  ],
  firmTypeName: [
    "Firm type values appear in Supply Order firm details.",
    "Renaming changes the available label for future selection and reporting.",
  ],
  firmTypeAdd: [
    "Adds a new firm type option for Supply Order firm details.",
    "The option becomes available wherever firm type selection or reporting is used.",
  ],
  firmTypeDelete: [
    "Removes this firm type option from Settings.",
    "Use cautiously if old files or reports still refer to this label.",
  ],
  fileTypeGroup: [
    "Goods & Services follows normal delivery, inspection, and bill behavior.",
    "MPC/AMC/O&M/CARS follows contract-style workflow behavior.",
  ],
  fileTypeDelete: [
    "Deletes only a non-default file type option.",
    "Deletion is blocked if any existing file uses this file type.",
    "Rename is allowed, but workflow group changes are restricted once used.",
  ],
  genericDelete: [
    "Removes this option from Settings.",
    "Use cautiously because old records or reports may still refer to this label.",
  ],
  userDelete: [
    "Moves this user account out of active use.",
    "This action needs the deletion password.",
  ],
  universalViewerCashOutgoScope: [
    "View only cannot save MER or Cash Out Go Plan changes.",
    "Personal Cash Out Go saves planning offsets and row dates only for that Universal Viewer account.",
    "Global Cash Out Go + MER can save official Cash Out Go Plan changes and MER for the software.",
  ],
  archiveRestore: [
    "Restores the archived item back to active records.",
    "Review details after restore if related settings have changed.",
  ],
  archiveDelete: [
    "Permanently deletes the archived item.",
    "This action needs the deletion password and cannot be undone from this screen.",
  ],
  ipMode: [
    "Off allows normal login and does not enforce trusted IPs.",
    "Notify allows login but records and notifies Admin when a new IP is used.",
    "Restrict blocks login from IPs that are not active in the trusted list.",
  ],
  ipCurrent: [
    "Shows the IP address detected for the current browser/backend request.",
    "Add it as trusted before enabling Restrict mode.",
  ],
  ipAddCurrent: [
    "Adds the currently detected IP to the trusted list.",
    "Use this when you are logged in from an authorised PC.",
  ],
  ipManualAddress: [
    "Enter an IP address that should be trusted for login.",
    "Keep the value exact because Restrict mode checks this address.",
  ],
  ipRemarks: [
    "Use remarks to identify the PC, office, user, or location.",
    "Remarks help Admin review trusted IPs later.",
  ],
  ipAddTrusted: [
    "Adds the entered IP address as trusted.",
    "Trusted IPs can be made active or inactive later.",
  ],
  trustedIpRemarks: [
    "Edit remarks to keep the trusted IP identifiable.",
    "Changes are saved when the field loses focus.",
  ],
  trustedIpActive: [
    "Active trusted IPs are allowed in Restrict mode.",
    "Inactive trusted IPs remain saved but are not allowed for login.",
  ],
  ipAttemptArchive: [
    "Moves this new IP attempt to the separate archive/bin.",
    "It is hidden from the active list but not permanently deleted.",
  ],
  ipAttemptBin: [
    "Shows archived new-IP login attempts.",
    "Permanent deletion from this bin needs the configured deletion password.",
  ],
  anomalyWorkflow: [
    "Current shows active suspected issues.",
    "Received request shows user acceptance requests waiting for Admin.",
    "Accepted, rejected, and revoked tabs show decision history.",
  ],
  anomalyRefresh: [
    "Reloads anomaly requests, decisions, and custom rules.",
    "Use this after another user has submitted or reviewed an anomaly.",
  ],
  anomalyFileAccept: [
    "Accepts this anomaly only for the selected file.",
    "The same rule can still flag other files.",
  ],
  anomalyUniversalAccept: [
    "Accepts this anomaly rule universally.",
    "Future matching rows may be suppressed across files.",
  ],
  anomalyReject: [
    "Sends a correction message back to the user.",
    "The anomaly remains unresolved until the file data is corrected or re-reviewed.",
  ],
  anomalyRevoke: [
    "Cancels a previous accepted decision.",
    "The anomaly can appear again if the underlying data still matches the rule.",
  ],
  anomalyClear: [
    "Clears selected rejected or revoked decision rows from the visible history.",
    "This action asks for your account password.",
  ],
  anomalyRuleAdd: [
    "Creates a custom anomaly rule.",
    "Custom rules can change which suspected issues appear in anomaly checks.",
  ],
  anomalyRuleToggle: [
    "Enables or disables this custom anomaly rule.",
    "Disabled rules stop creating matching anomaly results.",
  ],
} satisfies Record<string, string[]>;

type AnomalyAcceptanceRow = {
  signature: string;
  reason?: string;
  ruleKey?: string;
  ruleLabel?: string;
  previousField?: string;
  previousValue?: string;
  laterField?: string;
  laterValue?: string;
  context?: string;
  fileId?: string;
  fileRef?: string;
  status: string;
  scope: string;
  requestedByName?: string;
  requestedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  revokedByName?: string;
  revokedAt?: string;
  adminMessage?: string;
};

type SuspectedAnomalyRow = {
  signature: string;
  fileId: string;
  fileRef: string;
  division: string;
  block: string;
  rule: string;
  ruleKey?: string;
  previousField: string;
  previousDate: string;
  laterField: string;
  laterDate: string;
  requestStatus?: string;
  userExplanation?: string;
  adminMessage?: string;
  requestedByName?: string;
  requestedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
};

function humanizeSettingsAnomalyLabel(value?: string) {
  if (!value) return "";
  if (value === "fileclosedbutbgreturnpendingexists") {
    return "File is closed but BG return is still pending";
  }
  return value
    .replace(/fileclosed/g, "File closed ")
    .replace(/bgreturn/g, " BG return ")
    .replace(/pending/g, " pending ")
    .replace(/exists/g, " exists ")
    .replace(/jobcompletion/g, " Job Completion ")
    .replace(/financialsanction/g, " Financial Sanction ")
    .replace(/supplyorder/g, " Supply Order ")
    .replace(/should/g, " should ")
    .replace(/not/g, " not ")
    .replace(/before/g, " before ")
    .replace(/after/g, " after ")
    .replace(/date/g, " date ")
    .replace(/\s+/g, " ")
    .trim();
}

type AnomalyRuleRow = {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  fieldA: string;
  operator: string;
  fieldB?: string;
  fixedValue?: string;
  thresholdDays?: number;
  severity: string;
  scope: string;
  enabled: boolean;
};

type AnomalyRuleField = { key: string; label: string; scope: string };

function canViewAdminSettings(role: AppUserRole | undefined) {
  return role === "admin" || role === "sub_admin" || role === "universal_viewer";
}

function isUniversalViewer(role: AppUserRole | undefined) {
  return role === "universal_viewer";
}

function canViewAllDivisions(role: AppUserRole | undefined) {
  return role === "admin" || role === "sub_admin" || role === "universal_viewer";
}

function SettingsPage() {
  const activeUser = useActiveUser();
  const locationSearch = useRouterState({ select: (state) => state.location.search });
  const [activeAdminSection, setActiveAdminSection] = useState("divisions");
  const [unlockedAdminSections, setUnlockedAdminSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const requestedSection =
      typeof locationSearch.section === "string" ? locationSearch.section : undefined;
    if (requestedSection && adminSectionKeys.has(requestedSection)) {
      setActiveAdminSection(requestedSection);
    }
  }, [locationSearch.section]);

  if (activeUser?.role === "viewer" || activeUser?.role === "division_user") {
    return (
      <div className="space-y-4 max-w-6xl">
        <Tabs defaultValue="theme" className="space-y-4">
          <TabsList aria-label="Settings sections">
            <SettingsTabTrigger value="theme" label="UI theme" helperKey="theme" />
            <SettingsTabTrigger value="indentors" label="Indentors" helperKey="indentors" />
            <SettingsTabTrigger value="presets" label="Preset table fields" helperKey="presets" />
          </TabsList>
          <TabsContent value="theme">
            <PreferenceSettings />
          </TabsContent>
          <TabsContent value="indentors">
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="presets">
            <TableFieldPresetSettings />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  if (activeUser?.role === "sub_admin" || activeUser?.role === "editor") {
    const canEditMmgSummary = activeUser.role === "sub_admin";
    return (
      <div className="space-y-4 max-w-6xl">
        <Tabs defaultValue="user" className="space-y-4">
          <TabsList aria-label="Settings sections">
            <SettingsTabTrigger value="user" label="User" helperKey="user" />
            <SettingsTabTrigger value="indentors" label="Indentors" helperKey="indentors" />
            <SettingsTabTrigger value="firms" label="Firm Database" helperKey="firms" />
            <SettingsTabTrigger value="presets" label="Preset table fields" helperKey="presets" />
            {canEditMmgSummary ? (
              <SettingsTabTrigger
                value="anomalyGovernance"
                label="Anomaly Control"
                helperKey="anomalyGovernance"
              />
            ) : null}
            {canEditMmgSummary ? (
              <SettingsTabTrigger value="mmgSummary" label="MMG Summary" helperKey="mmgSummary" />
            ) : null}
          </TabsList>
          <TabsContent value="user">
            <AccountSettings />
          </TabsContent>
          <TabsContent value="indentors">
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="firms">
            <FirmDatabaseSettings />
          </TabsContent>
          <TabsContent value="presets">
            <TableFieldPresetSettings />
          </TabsContent>
          {canEditMmgSummary ? (
            <TabsContent value="anomalyGovernance">
              <AnomalyGovernanceSettings />
            </TabsContent>
          ) : null}
          {canEditMmgSummary ? (
            <TabsContent value="mmgSummary">
              <MmgSummarySettings />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    );
  }

  if (!canViewAdminSettings(activeUser?.role)) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Admin settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is available only to administrators.
        </p>
      </div>
    );
  }

  const allAdminSections: AdminSection[] = [
    {
      key: "user",
      label: "User",
      helper: settingsSectionHelpers.user,
      content: <AccountSettings />,
    },
    {
      key: "workspace",
      label: "Workspace",
      helper: settingsSectionHelpers.workspace,
      content: <WorkspaceSettings />,
    },
    {
      key: "yearSetup",
      label: "Year Setup",
      helper: settingsSectionHelpers.yearSetup,
      content: <YearSetupPanel />,
    },
    {
      key: "mmgSummary",
      label: "MMG Summary",
      helper: settingsSectionHelpers.mmgSummary,
      content: <MmgSummarySettings />,
    },
    {
      key: "demandProcessing",
      label: "Demand processing presets",
      helper: settingsSectionHelpers.demandProcessing,
      content: <DemandProcessingPresetSettings />,
    },
    {
      key: "divisions",
      label: "Divisions",
      helper: settingsSectionHelpers.divisions,
      content: <DivisionSettings />,
    },
    {
      key: "indentors",
      label: "Indentors",
      helper: settingsSectionHelpers.indentors,
      content: <IndentorSettings />,
    },
    {
      key: "firms",
      label: "Firm Database",
      helper: settingsSectionHelpers.firms,
      content: <FirmDatabaseSettings />,
    },
    {
      key: "firmRating",
      label: "Firm Rating",
      helper: settingsSectionHelpers.firmRating,
      content: <FirmRatingSettings />,
    },
    {
      key: "fileTypes",
      label: "File Types",
      helper: settingsSectionHelpers.fileTypes,
      content: <FileTypeSettings />,
    },
    {
      key: "modes",
      label: "Modes",
      helper: settingsSectionHelpers.modes,
      content: <ModeSettings />,
    },
    {
      key: "firmTypes",
      label: "Firm Types",
      helper: settingsSectionHelpers.firmTypes,
      content: <FirmTypeSettings />,
    },
    {
      key: "fileMarkers",
      label: "File Markers",
      helper: settingsSectionHelpers.fileMarkers,
      content: <SpecialFileMarkerSettings />,
    },
    {
      key: "tcec",
      label: "TCEC Committee",
      helper: settingsSectionHelpers.tcec,
      content: <TcecCommitteeSettings />,
    },
    {
      key: "thresholds",
      label: "Value thresholds",
      helper: settingsSectionHelpers.thresholds,
      content: <ValueThresholdSettings />,
    },
    {
      key: "anomalyGovernance",
      label: "Anomaly Control",
      helper: settingsSectionHelpers.anomalyGovernance,
      content: <AnomalyGovernanceSettings />,
    },
    {
      key: "milestones",
      label: "Milestones",
      helper: settingsSectionHelpers.milestones,
      content: <MilestoneSettings />,
    },
    {
      key: "presets",
      label: "Preset table fields",
      helper: settingsSectionHelpers.presets,
      content: <TableFieldPresetSettings />,
    },
    {
      key: "users",
      label: "Authorised users",
      helper: settingsSectionHelpers.users,
      content: <UserSettings />,
    },
    {
      key: "ipAccess",
      label: "IP Access",
      helper: settingsSectionHelpers.ipAccess,
      content: <IpAccessSettings />,
    },
    {
      key: "archive",
      label: "Archive",
      helper: settingsSectionHelpers.archive,
      content: <ArchiveSettings />,
    },
  ];
  const adminSections =
    activeUser?.role === "sub_admin"
      ? allAdminSections.filter((section) => section.key === "user" || section.key === "workspace")
      : allAdminSections;
  const selectedAdminSection =
    adminSections.find((section) => section.key === activeAdminSection) ?? adminSections[0];
  const universalViewer = isUniversalViewer(activeUser?.role);
  const selectedAdminSectionUnlocked =
    Boolean(unlockedAdminSections[selectedAdminSection.key]) ||
    (universalViewer && ["user", "presets"].includes(selectedAdminSection.key));

  const setAdminSectionUnlocked = (key: string, unlocked: boolean) => {
    setUnlockedAdminSections((current) => ({ ...current, [key]: unlocked }));
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="space-y-1">
            {adminSections.map((section) => {
              const selected = selectedAdminSection.key === section.key;
              return (
                <div key={section.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveAdminSection(section.key)}
                    className={
                      "min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                      (selected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    {section.label}
                  </button>
                  <SettingsHelper items={section.helper} label={`${section.label} help`} />
                </div>
              );
            })}
          </div>
        </aside>
        <div className="min-w-0">
          <LockedAdminSection
            section={selectedAdminSection}
            unlocked={selectedAdminSectionUnlocked}
            onLock={() => setAdminSectionUnlocked(selectedAdminSection.key, false)}
            onUnlock={() => setAdminSectionUnlocked(selectedAdminSection.key, true)}
            hideUnlock={universalViewer}
          />
        </div>
      </div>
    </div>
  );
}

function LockedAdminSection({
  section,
  unlocked,
  onLock,
  onUnlock,
  hideUnlock = false,
}: {
  section: AdminSection;
  unlocked: boolean;
  onLock: () => void;
  onUnlock: () => void;
  hideUnlock?: boolean;
}) {
  const [verifying, setVerifying] = useState(false);

  const unlock = async () => {
    const password = window.prompt(`Enter admin password to edit ${section.label}:`);
    if (password === null) return;
    if (!password.trim()) {
      window.alert("Password is required.");
      return;
    }
    setVerifying(true);
    try {
      await store.verifyAdminPassword(password);
      onUnlock();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Incorrect password.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      {!hideUnlock ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={unlocked ? onLock : () => void unlock()}
            disabled={verifying}
            className={
              "h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium disabled:cursor-wait disabled:opacity-60 " +
              (unlocked
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background hover:bg-accent")
            }
          >
            {unlocked ? (
              <>
                <Unlock className="size-4" /> Unlocked
              </>
            ) : (
              <>
                <Lock className="size-4" /> Edit
              </>
            )}
          </button>
        </div>
      ) : null}
      <fieldset
        disabled={!unlocked}
        className={
          !unlocked ? "pointer-events-none opacity-70 [&_*]:cursor-not-allowed" : undefined
        }
      >
        {section.content}
      </fieldset>
    </div>
  );
}

function SettingsTabTrigger({
  value,
  label,
  helperKey,
}: {
  value: string;
  label: string;
  helperKey: keyof typeof settingsSectionHelpers;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <TabsTrigger value={value}>{label}</TabsTrigger>
      <SettingsHelper items={settingsSectionHelpers[helperKey]} label={`${label} help`} />
    </span>
  );
}

function SettingsHelper({ items, label }: { items: string[]; label: string }) {
  const bullets = splitHelperText(items);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(event) => event.preventDefault()}
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <Info className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-xs text-xs leading-relaxed">
          <ul className="list-disc space-y-1 pl-4">
            {bullets.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function HelpedControl({
  helper,
  label,
  children,
}: {
  helper: string[];
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <SettingsHelper items={helper} label={label} />
    </span>
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

function PreferenceSettings() {
  const settings = useSettings();
  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold mb-1">UI theme</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Choose the display theme for your own login.
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ThemeField
            label="Theme"
            value={settings.theme}
            onChange={(value) => store.updateSettings({ theme: value })}
          />
          <ThemeTintField
            label="Theme color"
            value={settings.themeTint}
            onChange={(value) => store.updateSettings({ themeTint: value })}
          />
        </div>
      </div>
      <AddEditRibbonSettings />
    </div>
  );
}

function AccountSettings() {
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const settings = useSettings();
  const assignedDivisionNames =
    activeUser?.role === "sub_admin"
      ? "All divisions"
      : activeUser?.divisionIds
          .map((id) => divisions.find((division) => division.id === id)?.name)
          .filter(Boolean)
          .join(", ") || "No divisions assigned";

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">User settings</h2>
      <p className="text-xs text-muted-foreground mb-5">View your account and access details.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" value={activeUser?.name ?? "Not signed in"} />
        <Field label="Username" value={activeUser?.username ?? "Not signed in"} />
        <Field label="Role" value={activeUser ? roleLabel(activeUser.role) : "Not signed in"} />
        <Field label="Divisions" value={assignedDivisionNames} />
      </div>

      {(activeUser?.role === "editor" ||
        activeUser?.role === "sub_admin" ||
        activeUser?.role === "universal_viewer") && (
        <div className="mt-5 max-w-sm">
          <ThemeTintField
            label="UI tint"
            value={settings.themeTint}
            onChange={(value) => store.updateSettings({ themeTint: value })}
          />
        </div>
      )}

      {activeUser ? (
        <div className="mt-5">
          <AddEditRibbonSettings />
        </div>
      ) : null}
    </div>
  );
}

function AddEditRibbonSettings() {
  const settings = useSettings();
  const selected = normalizeAddEditRibbonFields(
    settings.addEditRibbonFields ?? defaultAddEditRibbonFields,
  );
  const updateField = (index: number, value: AddEditRibbonFieldKey) => {
    const next: AddEditRibbonFieldKey[] = [...selected];
    next[index] = value;
    store.updateSettings({ addEditRibbonFields: next });
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Add/Edit file top ribbon</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Demand description is always shown on the first line. Choose the second and third line for
        your own login.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <RibbonFieldSelect
          label="Second line"
          value={selected[0]}
          onChange={(value) => updateField(0, value)}
        />
        <RibbonFieldSelect
          label="Third line"
          value={selected[1]}
          onChange={(value) => updateField(1, value)}
        />
      </div>
    </div>
  );
}

const mmgLiveTrialOptions = [
  {
    key: "status1",
    label: "Status-1",
    description: "Milestone status counts from Dashboard.",
  },
  {
    key: "status2",
    label: "Status-2",
    description: "Division-wise live milestone table from Dashboard.",
  },
  {
    key: "finance",
    label: "Finance totals",
    description: "Allocated, intended, booked, committed, and spent totals.",
  },
] as const;

function MmgLiveSettings() {
  const settings = useSettings();
  const selectedOptions = settings.mmgLiveOptions ?? [];

  const toggleOption = (optionKey: string) => {
    const next = selectedOptions.includes(optionKey)
      ? selectedOptions.filter((key) => key !== optionKey)
      : [...selectedOptions, optionKey];
    store.updateSettings({ mmgLiveOptions: next });
  };

  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 text-sm font-semibold">MMG live</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Trial setup for publishing selected Dashboard/Reports summaries to a read-only local
            intranet page.
          </p>
        </div>
        <a
          href="/mmg-live"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
        >
          Preview
        </a>
      </div>

      <label className="mb-4 flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/25 px-3 py-2">
        <span>
          <span className="block text-sm font-medium">Activate MMG live page</span>
          <span className="block text-xs text-muted-foreground">
            When inactive, the public page shows an unavailable message.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.mmgLiveEnabled === true}
          onChange={(event) => store.updateSettings({ mmgLiveEnabled: event.target.checked })}
          className="size-4"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {mmgLiveTrialOptions.map((option) => (
          <label
            key={option.key}
            className={
              "rounded-md border p-4 transition " +
              (selectedOptions.includes(option.key)
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:bg-accent")
            }
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{option.label}</div>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
              </div>
              <input
                type="checkbox"
                checked={selectedOptions.includes(option.key)}
                onChange={() => toggleOption(option.key)}
                className="mt-0.5 size-4"
              />
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
        Public URL: <span className="font-medium text-foreground">/mmg-live</span>
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [selectedYearFileCount, setSelectedYearFileCount] = useState(0);
  const [newFinancialYear, setNewFinancialYear] = useState("");
  const [newFinancialYearError, setNewFinancialYearError] = useState("");
  const [workspaceYear, setWorkspaceYear] = useState(settings.financialYear);
  const financialYears = useMemo(
    () =>
      Array.from(
        new Set(
          [settings.financialYear, settings.setupYear, workspaceYear, ...settings.financialYears]
            .filter(Boolean)
            .filter(
              (year) =>
                !isAllFilesYear(year) &&
                !isAllActiveFilesYear(year) &&
                !isActivePlusCurrentFyClosedYear(year),
            ),
        ),
      ).sort((a, b) => b.localeCompare(a)),
    [settings.financialYear, settings.financialYears, settings.setupYear, workspaceYear],
  );
  const suggestedFinancialYear = getNextFinancialYearLabel(financialYears);
  useEffect(() => {
    if (financialYears.includes(workspaceYear)) return;
    setWorkspaceYear(settings.financialYear);
  }, [financialYears, settings.financialYear, workspaceYear]);
  useEffect(() => {
    let cancelled = false;
    fetchFilesForYear(workspaceYear)
      .then((payload) => {
        if (!cancelled) setSelectedYearFileCount(payload.files.length);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSelectedYearFileCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceYear]);
  const canDeleteSelectedYear =
    workspaceYear !== settings.financialYear &&
    selectedYearFileCount === 0 &&
    financialYears.length > 1;
  const canEditWorkspaceGlobals = activeUser?.role === "admin";
  const canEditPreSoOffsets = activeUser?.role === "admin" || activeUser?.role === "sub_admin";

  const addFinancialYear = () => {
    const label = newFinancialYear.trim() || suggestedFinancialYear;
    if (!label) return;
    const error = validateNewFinancialYearLabel(label, financialYears);
    if (error) {
      setNewFinancialYearError(error);
      return;
    }
    setNewFinancialYearError("");
    store.addFinancialYear(label, true);
    setNewFinancialYear("");
  };

  const setCurrentFinancialYear = () => {
    store.updateSettings({
      financialYear: workspaceYear,
      selectedYear: ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
      setupYear: workspaceYear,
    });
  };

  const toggleYearSelectionLock = () => {
    store.updateSettings({ yearSelectionLocked: !settings.yearSelectionLocked });
  };

  const deleteSelectedFinancialYear = async () => {
    if (!canDeleteSelectedYear) return;
    if (await requestDeletionPassword(`delete financial year "${workspaceYear}"`)) {
      store.deleteFinancialYear(workspaceYear);
      setWorkspaceYear(settings.financialYear);
    }
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Workspace</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Configure how this records system behaves.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2 rounded-md border border-border bg-secondary/20 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Financial years</h3>
              <p className="text-xs text-muted-foreground">
                Manage the official current FY and Add File year lock.
              </p>
            </div>
            <span className="rounded bg-background px-2 py-1 text-xs text-muted-foreground">
              Current: {displayFinancialYearLabel(settings.financialYear)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(260px,1fr)]">
            <label className="block">
              <div className="mb-1.5 text-xs font-medium">FY</div>
              <select
                value={workspaceYear}
                onChange={(event) => setWorkspaceYear(event.target.value)}
                disabled={!canEditWorkspaceGlobals}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {financialYears.map((year) => (
                  <option key={year} value={year}>
                    {displayFinancialYearLabel(year)}
                  </option>
                ))}
              </select>
            </label>

            <div className="block">
              <label htmlFor="workspace-add-year" className="mb-1.5 block text-xs font-medium">
                Add year
              </label>
              <div className="flex gap-2">
                <input
                  id="workspace-add-year"
                  value={newFinancialYear || suggestedFinancialYear}
                  onChange={(event) => {
                    setNewFinancialYear(event.target.value);
                    setNewFinancialYearError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addFinancialYear();
                  }}
                  placeholder={suggestedFinancialYear}
                  disabled={!canEditWorkspaceGlobals}
                  className="h-10 min-w-0 flex-1 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
                <button
                  type="button"
                  onClick={addFinancialYear}
                  disabled={!canEditWorkspaceGlobals}
                  className="h-10 shrink-0 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                >
                  <Plus className="size-4" /> Add Year
                </button>
              </div>
              {newFinancialYearError ? (
                <div className="mt-1.5 text-xs text-destructive">{newFinancialYearError}</div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
              <button
                type="button"
                onClick={setCurrentFinancialYear}
                disabled={!canEditWorkspaceGlobals || workspaceYear === settings.financialYear}
                className="h-10 min-w-40 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                <Check className="size-4" /> Set as Current FY
              </button>
              <SettingsHelper
                items={workspaceYearHelpers.setCurrent}
                label="Set as Current FY help"
              />

              <button
                type="button"
                onClick={toggleYearSelectionLock}
                disabled={!canEditWorkspaceGlobals}
                className={
                  "h-10 min-w-36 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border text-sm font-medium " +
                  (settings.yearSelectionLocked
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-background hover:bg-accent")
                }
              >
                {settings.yearSelectionLocked ? (
                  <>
                    <Lock className="size-4" /> Locked
                  </>
                ) : (
                  <>
                    <Unlock className="size-4" /> Unlocked
                  </>
                )}
              </button>
              <SettingsHelper items={workspaceYearHelpers.lockSelection} label="Year lock help" />

              <HelpedControl
                helper={settingsControlHelpers.workspaceDelete}
                label="Delete financial year help"
              >
                <button
                  type="button"
                  onClick={deleteSelectedFinancialYear}
                  disabled={!canEditWorkspaceGlobals || !canDeleteSelectedYear}
                  className="h-10 min-w-32 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-background text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </HelpedControl>
            </div>
          </div>
        </div>
        <ThemeField
          label="Theme"
          value={settings.theme}
          onChange={(value) => store.updateSettings({ theme: value })}
        />
        <ThemeTintField
          label="Theme color"
          value={settings.themeTint}
          onChange={(value) => store.updateSettings({ themeTint: value })}
        />
        <PasswordField
          label="Deletion password"
          value={settings.deletionPassword}
          onChange={(value) => {
            if (canEditWorkspaceGlobals) store.updateSettings({ deletionPassword: value });
          }}
          disabled={!canEditWorkspaceGlobals}
          helper={deletionPasswordHelper}
        />
        <div className="md:col-span-2 rounded-md border border-border bg-secondary/20 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Pre-S.O. expected cash outgo defaults</h3>
            <p className="text-xs text-muted-foreground">
              These defaults are used in Reports → Pre-S.O. based expected cash outgo unless a stage
              override is saved in the report.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1.5 text-xs font-medium">Default S.O. offset days</div>
              <input
                type="number"
                min="0"
                value={settings.preSoDefaultSoOffsetDays ?? 30}
                disabled={!canEditPreSoOffsets}
                onChange={(event) =>
                  store.updateSettings({
                    preSoDefaultSoOffsetDays: Math.max(0, Number(event.target.value || 0)),
                  })
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
              />
            </label>
            <label className="block">
              <div className="mb-1.5 text-xs font-medium">Default payment offset days</div>
              <input
                type="number"
                min="0"
                value={settings.preSoDefaultPaymentOffsetDays ?? 30}
                disabled={!canEditPreSoOffsets}
                onChange={(event) =>
                  store.updateSettings({
                    preSoDefaultPaymentOffsetDays: Math.max(0, Number(event.target.value || 0)),
                  })
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function TcecCommitteeSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const committees = settings.tcecCommittees ?? [];

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateCommittees = (next: string[]) => {
    store.updateSettings({ tcecCommittees: next });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = committees.some(
      (committee) => committee.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setName("");
      return;
    }
    updateCommittees([...committees, trimmed]);
    setName("");
  };

  const remove = (committee: string) => {
    updateCommittees(committees.filter((item) => item !== committee));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">TCEC Committee</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add committee names for selection in TCEC fields.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Committee name" />
        <HelpedControl helper={settingsControlHelpers.firmTypeAdd} label="Add firm type help">
          <button
            type="button"
            onClick={add}
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add
          </button>
        </HelpedControl>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {committees.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No committee names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {committees.map((committee) => (
              <li key={committee} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium">{committee}</span>
                <HelpedControl
                  helper={settingsControlHelpers.genericDelete}
                  label={`Delete ${committee} help`}
                >
                  <button
                    type="button"
                    onClick={() => remove(committee)}
                    className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                    aria-label={`Delete ${committee}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </HelpedControl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FirmTypeSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const firmTypes = normalizeFirmTypes(settings.firmTypes);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateFirmTypes = (next: string[]) => {
    store.updateSettings({ firmTypes: normalizeFirmTypes(next) });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = firmTypes.some((firmType) => firmType.toLowerCase() === trimmed.toLowerCase());
    if (!exists) updateFirmTypes([...firmTypes, trimmed]);
    setName("");
  };

  const rename = (index: number, value: string) => {
    const next = [...firmTypes];
    next[index] = value;
    updateFirmTypes(next);
  };

  const remove = (index: number) => {
    updateFirmTypes(firmTypes.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-1 inline-flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Firm Types</h2>
        <SettingsHelper items={settingsControlHelpers.firmTypeName} label="Firm types help" />
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Add and edit the firm type values shown in Supply Order forms and search filters.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Firm type" />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {firmTypes.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No firm types added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {firmTypes.map((firmType, index) => (
              <li key={`${firmType}-${index}`} className="flex items-center gap-3 px-4 py-3">
                <input
                  value={firmType}
                  onChange={(event) => rename(index, event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
                <HelpedControl
                  helper={settingsControlHelpers.firmTypeDelete}
                  label={`Delete ${firmType} help`}
                >
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                    aria-label={`Delete ${firmType}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </HelpedControl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModeSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const modes = normalizeModes(settings.modes);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateModes = (next: string[]) => {
    store.updateSettings({ modes: normalizeModes(next) });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = modes.some((mode) => mode.toLowerCase() === trimmed.toLowerCase());
    if (!exists) updateModes([...modes, trimmed]);
    setName("");
  };

  const rename = (index: number, value: string) => {
    const next = [...modes];
    next[index] = value;
    updateModes(next);
  };

  const remove = (index: number) => {
    if (isDefaultMode(modes[index])) return;
    updateModes(modes.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Modes</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add and edit the mode values shown in File Details, Search, and Dashboard Snapshot.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Mode" />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {modes.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No modes added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {modes.map((mode, index) => {
              const protectedMode = isDefaultMode(mode);
              return (
                <li key={`${mode}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <input
                    value={mode}
                    onChange={(event) => rename(index, event.target.value)}
                    disabled={protectedMode}
                    className={
                      "h-9 min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                      (protectedMode ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                    }
                  />
                  {protectedMode ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
                      Default
                    </span>
                  ) : (
                    <HelpedControl
                      helper={settingsControlHelpers.genericDelete}
                      label={`Delete ${mode} help`}
                    >
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${mode}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </HelpedControl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function FileTypeSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const [newFileTypeGroup, setNewFileTypeGroup] = useState<FileTypeGroup>("goodsServices");
  const fileTypes = normalizeFileTypes(settings.fileTypes);
  const fileTypeGroups = normalizeFileTypeGroups(settings.fileTypeGroups, fileTypes);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateFileTypes = (next: string[], nextGroups: FileTypeGroupSetting[] = fileTypeGroups) => {
    const normalizedTypes = normalizeFileTypes(next);
    store.updateSettings({
      fileTypes: normalizedTypes,
      fileTypeGroups: normalizeFileTypeGroups(nextGroups, normalizedTypes),
    });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = fileTypes.some((fileType) => fileType.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      updateFileTypes(
        [...fileTypes, trimmed],
        [...fileTypeGroups, { fileType: trimmed, group: newFileTypeGroup }],
      );
    }
    setName("");
    setNewFileTypeGroup("goodsServices");
  };

  const rename = (index: number, value: string) => {
    const next = [...fileTypes];
    const oldFileType = next[index];
    next[index] = value;
    const nextGroups = fileTypeGroups.map((entry) =>
      entry.fileType === oldFileType ? { ...entry, fileType: value } : entry,
    );
    updateFileTypes(next, nextGroups);
  };

  const updateGroup = (fileType: string, group: FileTypeGroup) => {
    const nextGroups = [
      ...fileTypeGroups.filter(
        (entry) => entry.fileType.trim().toLowerCase() !== fileType.trim().toLowerCase(),
      ),
      { fileType, group },
    ];
    updateFileTypes(fileTypes, nextGroups);
  };

  const remove = (index: number) => {
    if (isDefaultFileType(fileTypes[index])) return;
    const removed = fileTypes[index];
    updateFileTypes(
      fileTypes.filter((_, itemIndex) => itemIndex !== index),
      fileTypeGroups.filter(
        (entry) => entry.fileType.trim().toLowerCase() !== removed.trim().toLowerCase(),
      ),
    );
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">File Types</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add file types and assign the workflow group used by future files.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="File type" />
        <div className="flex items-center gap-1">
          <select
            value={newFileTypeGroup}
            onChange={(event) => setNewFileTypeGroup(event.target.value as FileTypeGroup)}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Workflow group for new file type"
          >
            {fileTypeGroupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SettingsHelper items={settingsControlHelpers.fileTypeGroup} label="File type group help" />
        </div>
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {fileTypes.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No file types added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {fileTypes.map((fileType, index) => {
              const protectedFileType = isDefaultFileType(fileType);
              return (
                <li
                  key={`${fileType}-${index}`}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px_auto]"
                >
                  <input
                    value={fileType}
                    onChange={(event) => rename(index, event.target.value)}
                    disabled={protectedFileType}
                    className={
                      "h-9 min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                      (protectedFileType
                        ? "bg-secondary/50 text-muted-foreground"
                        : "bg-background")
                    }
                  />
                  <div className="flex items-center gap-1">
                    <select
                      value={
                        fileTypeGroups.find(
                          (entry) =>
                            entry.fileType.trim().toLowerCase() === fileType.trim().toLowerCase(),
                        )?.group ?? getDefaultFileTypeGroup(fileType)
                      }
                      onChange={(event) =>
                        updateGroup(fileType, event.target.value as FileTypeGroup)
                      }
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                      aria-label={`Workflow group for ${fileType}`}
                    >
                      {fileTypeGroupOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <SettingsHelper
                      items={settingsControlHelpers.fileTypeGroup}
                      label={`${fileType} workflow group help`}
                    />
                  </div>
                  {protectedFileType ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
                      Default
                    </span>
                  ) : (
                    <HelpedControl
                      helper={settingsControlHelpers.fileTypeDelete}
                      label={`Delete ${fileType} help`}
                    >
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${fileType}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </HelpedControl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function normalizeSpecialFileMarkers(markers: SpecialFileMarker[] | undefined) {
  const seen = new Set<string>();
  return (markers ?? [])
    .map((marker) => ({
      code: marker.code.trim().toUpperCase(),
      description: marker.description.trim(),
    }))
    .filter((marker) => {
      if (!marker.code || seen.has(marker.code)) return false;
      seen.add(marker.code);
      return true;
    });
}

function SpecialFileMarkerSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const markers = normalizeSpecialFileMarkers(settings.specialFileMarkers);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateMarkers = (next: SpecialFileMarker[]) => {
    store.updateSettings({ specialFileMarkers: normalizeSpecialFileMarkers(next) });
  };

  const add = () => {
    const nextCode = code.trim().toUpperCase();
    if (!nextCode) return;
    updateMarkers([
      ...markers.filter((marker) => marker.code !== nextCode),
      { code: nextCode, description: description.trim() },
    ]);
    setCode("");
    setDescription("");
  };

  const rename = (index: number, value: string) => {
    const next = [...markers];
    next[index] = { ...next[index], code: value.trim().toUpperCase() };
    updateMarkers(next);
  };

  const updateDescription = (index: number, value: string) => {
    const next = [...markers];
    next[index] = { ...next[index], description: value };
    updateMarkers(next);
  };

  const remove = (index: number) => {
    updateMarkers(markers.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Special File Marker Codes</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Define marker codes for special scenarios that can be attached to files and searched later.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[12rem_1fr_auto] gap-3">
        <DivisionInput value={code} onChange={setCode} placeholder="Code" />
        <DivisionInput
          value={description}
          onChange={setDescription}
          placeholder="Explanation / when to use"
        />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {markers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No marker codes added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {markers.map((marker, index) => (
              <li
                key={`${marker.code}-${index}`}
                className="grid gap-3 px-4 py-3 md:grid-cols-[12rem_1fr_auto]"
              >
                <input
                  value={marker.code}
                  onChange={(event) => rename(index, event.target.value)}
                  className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-ring/40"
                />
                <input
                  value={marker.description}
                  onChange={(event) => updateDescription(index, event.target.value)}
                  className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
                <HelpedControl
                  helper={settingsControlHelpers.genericDelete}
                  label={`Delete ${marker.code} help`}
                >
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="size-9 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                    aria-label={`Delete ${marker.code}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </HelpedControl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function normalizeFirmTypes(values: string[] | undefined) {
  const seen = new Set<string>();
  const normalized = (values?.length ? values : defaultFirmTypes)
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return normalized.length ? normalized : defaultFirmTypes;
}

function normalizeFileTypes(values: string[] | undefined) {
  const seen = new Set<string>();
  const normalized = [...defaultFileTypes, ...(values ?? [])]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return normalized.length ? normalized : defaultFileTypes;
}

function normalizeModes(values: string[] | undefined) {
  const seen = new Set<string>();
  const normalized = [...defaultModes, ...(values ?? [])]
    .map((value) => value.trim().toUpperCase())
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  return normalized.length ? normalized : defaultModes;
}

function isDefaultFileType(fileType: string | undefined) {
  const normalized = fileType?.trim().toLowerCase();
  return Boolean(normalized && defaultFileTypes.some((item) => item.toLowerCase() === normalized));
}

function isDefaultMode(mode: string | undefined) {
  const normalized = mode?.trim().toUpperCase();
  return Boolean(normalized && defaultModes.includes(normalized));
}

const defaultThresholdAppliesTo: ValueThresholdAppliesTo = "both";

function createThresholdLevels(count: number, existing: ValueThresholdLevel[]) {
  return Array.from({ length: count }, (_, index) => {
    const levelNumber = index + 1;
    const current = existing[index];
    return {
      label: current?.label || `Level ${levelNumber}`,
      levelNumber,
      minValue: current?.minValue ?? "",
      maxValue: current?.maxValue ?? "",
      appliesTo: current?.appliesTo ?? defaultThresholdAppliesTo,
    };
  });
}

function ValueThresholdSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const selectedYear = settings.setupYear || settings.financialYear;
  const [levels, setLevels] = useState<ValueThresholdLevel[]>(() =>
    formatThresholdLevels(settings.valueThresholdLevels ?? []),
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLevels(formatThresholdLevels(settings.valueThresholdLevels ?? []));
    setMessage("");
  }, [settings.setupYear, settings.valueThresholdLevels]);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const levelCount = levels.length;
  const normalizeLevelsForSave = (nextLevels = levels) =>
    nextLevels.map((level, index) => ({
      ...level,
      label: level.label.trim() || `Level ${index + 1}`,
      levelNumber: index + 1,
      minValue: formatThresholdAmountInput(level.minValue) || "",
      maxValue: formatThresholdAmountInput(level.maxValue) || "",
      appliesTo: level.appliesTo || defaultThresholdAppliesTo,
    }));
  const thresholdsChanged = !isSettingsDirtyValueEqual(
    normalizeLevelsForSave(levels),
    normalizeLevelsForSave(formatThresholdLevels(settings.valueThresholdLevels ?? [])),
  );
  const save = (nextLevels = levels) => {
    const normalized = normalizeLevelsForSave(nextLevels);
    const invalid = normalized.find((level) => {
      const min = parseOptionalPositiveNumber(level.minValue);
      const max = parseOptionalPositiveNumber(level.maxValue);
      return (
        min.invalid ||
        max.invalid ||
        (min.value !== undefined && max.value !== undefined && min.value > max.value)
      );
    });
    if (invalid) {
      setMessage("Check threshold values before saving.");
      return;
    }
    setLevels(normalized);
    setMessage("Thresholds saved.");
    store.updateSettings({ setupYear: selectedYear, valueThresholdLevels: normalized });
  };

  const updateCount = (count: number) => {
    const next = createThresholdLevels(count, levels);
    setLevels(next);
    setMessage("");
  };

  const updateLevel = (index: number, patch: Partial<ValueThresholdLevel>) => {
    setLevels((current) =>
      current.map((level, levelIndex) =>
        levelIndex === index ? { ...level, ...patch, levelNumber: levelIndex + 1 } : level,
      ),
    );
    setMessage("");
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Value thresholds</h2>
          <p className="text-xs text-muted-foreground">
            Configure value levels for {selectedYear}. Files are matched by capital/revenue value.
          </p>
        </div>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Levels</div>
          <select
            value={String(levelCount)}
            onChange={(event) => updateCount(Number(event.target.value))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="0">Select</option>
            {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      </div>

      {levels.length === 0 ? (
        <div className="rounded-md border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          Select the number of threshold levels to begin.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-[780px] w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Applies to</th>
                <th className="px-3 py-2 text-left font-medium">Min value</th>
                <th className="px-3 py-2 text-left font-medium">Max value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {levels.map((level, index) => (
                <tr key={index}>
                  <td className="px-3 py-2 font-medium">{index + 1}</td>
                  <td className="px-3 py-2">
                    <input
                      value={level.label}
                      onChange={(event) => updateLevel(index, { label: event.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={level.appliesTo}
                      onChange={(event) =>
                        updateLevel(index, {
                          appliesTo: event.target.value as ValueThresholdAppliesTo,
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="both">Both</option>
                      <option value="capital">Capital</option>
                      <option value="revenue">Revenue</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={level.minValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          minValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      inputMode="decimal"
                      placeholder="No minimum"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={level.maxValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          maxValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      inputMode="decimal"
                      placeholder="No maximum"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{message}</div>
        <button
          type="button"
          onClick={() => save()}
          disabled={!thresholdsChanged}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="size-4" /> Save thresholds
        </button>
      </div>
    </div>
  );
}

function parseOptionalPositiveNumber(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return { value: undefined, invalid: false };
  const parsed = Number(cleaned);
  return {
    value: Number.isFinite(parsed) ? parsed : undefined,
    invalid: !Number.isFinite(parsed) || parsed < 0,
  };
}

function formatThresholdLevels(levels: ValueThresholdLevel[]) {
  return levels.map((level) => ({
    ...level,
    minValue: formatThresholdAmountInput(level.minValue),
    maxValue: formatThresholdAmountInput(level.maxValue),
  }));
}

function formatThresholdAmountInput(value: string | undefined) {
  const raw = String(value ?? "").replace(/,/g, "");
  const sanitized = raw.replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = sanitized.split(".");
  const decimalPart = decimalParts.join("");
  const formattedInteger = formatIndianIntegerInput(integerPart);
  if (sanitized.includes(".")) return `${formattedInteger}.${decimalPart}`;
  return formattedInteger;
}

function formatIndianIntegerInput(integerPart: string) {
  const trimmed = integerPart.replace(/^0+(?=\d)/, "");
  const lastThree = trimmed.slice(-3);
  const beforeThousands = trimmed.slice(0, -3);
  if (!beforeThousands) return trimmed;
  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
}

function AnomalyGovernanceSettings() {
  const [acceptances, setAcceptances] = useState<AnomalyAcceptanceRow[]>([]);
  const [activeAnomalies, setActiveAnomalies] = useState<SuspectedAnomalyRow[]>([]);
  const [rules, setRules] = useState<AnomalyRuleRow[]>([]);
  const [fields, setFields] = useState<AnomalyRuleField[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [workflowTab, setWorkflowTab] = useState<
    "current" | "sent" | "fileAccepted" | "universalAccepted" | "rejected" | "revoked"
  >("current");
  const [selectedDecisionSignatures, setSelectedDecisionSignatures] = useState<string[]>([]);
  const settings = useSettings();

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [acceptancePayload, rulePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        store.listAnomalyRules(),
        store.listSuspectedAnomalies(settings.selectedYear),
      ]);
      setAcceptances(acceptancePayload.acceptances);
      setRules(rulePayload.rules);
      setFields(rulePayload.fields);
      setActiveAnomalies(anomalyPayload.rows);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to load anomaly control.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [settings.selectedYear]);

  const fieldLabel = (key?: string) =>
    fields.find((field) => field.key === key)?.label ?? key ?? "";
  const anomalySummary = (row: AnomalyAcceptanceRow) => ({
    title: row.ruleLabel || humanizeSettingsAnomalyLabel(row.ruleKey) || "Anomaly exception",
    detail:
      row.previousField || row.laterField
        ? `${row.previousField || "Expected"}: ${row.previousValue || "-"}; ${row.laterField || "Found"}: ${row.laterValue || "-"}`
        : row.context
          ? `Context: ${row.context}`
          : "",
  });
  const formatStatus = (status: string) =>
    status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const review = async (signature: string, action: string) => {
    const adminMessage =
      action === "reject"
        ? window.prompt("Correction message to User explaining what should be fixed:")
        : undefined;
    if (action === "reject" && !adminMessage?.trim()) return;
    try {
      await store.reviewSuspectedAnomaly(signature, action, adminMessage?.trim());
      await load();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Could not review anomaly.");
    }
  };

  const clearSelected = async (signatures: string[]) => {
    if (!signatures.length) return;
    const password = window.prompt("Enter your account password to clear selected anomalies:");
    if (!password?.trim()) return;
    try {
      await store.clearSuspectedAnomalyHistory(password.trim(), signatures);
      setSelectedDecisionSignatures([]);
      await load();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Could not clear anomaly history.");
    }
  };

  const toggleRule = async (rule: AnomalyRuleRow) => {
    try {
      await store.updateAnomalyRule(rule.id, { enabled: !rule.enabled });
      await load();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Could not update anomaly rule.");
    }
  };

  const createRule = async () => {
    const name = window.prompt("Rule name:");
    if (!name?.trim()) return;
    const fieldA = window.prompt(
      `Field A key:\n${fields.map((field) => `${field.key} - ${field.label}`).join("\n")}`,
    );
    if (!fieldA?.trim()) return;
    const ruleType = window.prompt(
      "Rule type: date_order, required_field, delay_days, date_boundary",
      "date_order",
    );
    if (!ruleType?.trim()) return;
    const fieldB = ruleType === "date_boundary" ? "" : window.prompt("Field B key:");
    if (ruleType !== "date_boundary" && !fieldB?.trim()) return;
    const operator =
      ruleType === "required_field"
        ? "requires"
        : ruleType === "date_boundary"
          ? window.prompt("Operator: not_before_fixed or not_after_fixed", "not_before_fixed")
          : window.prompt("Operator: not_before or not_after", "not_before");
    if (!operator?.trim()) return;
    const fixedValue =
      ruleType === "date_boundary"
        ? window.prompt("Fixed date (DD-MM-YYYY or YYYY-MM-DD):")
        : undefined;
    if (ruleType === "date_boundary" && !fixedValue?.trim()) return;
    const thresholdDays =
      ruleType === "delay_days"
        ? Number.parseInt(window.prompt("Threshold days:", "0") ?? "", 10)
        : undefined;
    try {
      await store.createAnomalyRule({
        name: name.trim(),
        ruleType: ruleType.trim(),
        fieldA: fieldA.trim(),
        operator: operator.trim(),
        fieldB: fieldB?.trim(),
        fixedValue: fixedValue?.trim(),
        thresholdDays,
        severity: "Medium",
        scope: "all",
        enabled: true,
      });
      await load();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Could not create anomaly rule.");
    }
  };

  const currentAnomalies = activeAnomalies.filter(
    (row) =>
      row.requestStatus !== "pending" &&
      row.requestStatus !== "rejected" &&
      row.requestStatus !== "revoked",
  );
  const sentAnomalies = activeAnomalies.filter((row) => row.requestStatus === "pending");
  const fileAcceptedAnomalies = acceptances.filter((row) => row.status === "approved_file");
  const universalAcceptedAnomalies = acceptances.filter(
    (row) => row.status === "approved_universal",
  );
  const rejectedAnomalies = acceptances.filter((row) => row.status === "rejected");
  const revokedAnomalies = acceptances.filter((row) => row.status === "revoked");
  const decisionAnomalies =
    workflowTab === "fileAccepted"
      ? fileAcceptedAnomalies
      : workflowTab === "universalAccepted"
        ? universalAcceptedAnomalies
        : workflowTab === "rejected"
          ? rejectedAnomalies
          : workflowTab === "revoked"
            ? revokedAnomalies
            : [];
  const workflowTabs = [
    { key: "current" as const, label: "Current", count: currentAnomalies.length },
    { key: "sent" as const, label: "Received request", count: sentAnomalies.length },
    { key: "fileAccepted" as const, label: "File Accepted", count: fileAcceptedAnomalies.length },
    {
      key: "universalAccepted" as const,
      label: "Universal Accepted",
      count: universalAcceptedAnomalies.length,
    },
    { key: "rejected" as const, label: "Rejected", count: rejectedAnomalies.length },
    { key: "revoked" as const, label: "Revoked", count: revokedAnomalies.length },
  ];
  const canClearDecisionRows = workflowTab === "rejected" || workflowTab === "revoked";
  const selectedDecisionSet = new Set(selectedDecisionSignatures);
  const toggleDecisionSignature = (signature: string) => {
    setSelectedDecisionSignatures((current) =>
      current.includes(signature)
        ? current.filter((item) => item !== signature)
        : [...current, signature],
    );
  };
  useEffect(() => {
    setSelectedDecisionSignatures([]);
  }, [workflowTab]);
  const decisionSignatureKey = decisionAnomalies.map((row) => row.signature).join("|");
  useEffect(() => {
    setSelectedDecisionSignatures((current) =>
      current.filter((signature) => decisionAnomalies.some((row) => row.signature === signature)),
    );
  }, [decisionSignatureKey]);
  const groupActive = (rows: SuspectedAnomalyRow[]) => {
    const groups = new Map<string, SuspectedAnomalyRow[]>();
    rows.forEach((row) => {
      const key = row.rule || row.ruleKey || "Suspected anomaly";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
  };
  const groupHistory = (rows: AnomalyAcceptanceRow[]) => {
    const groups = new Map<string, AnomalyAcceptanceRow[]>();
    rows.forEach((row) => {
      const key = row.ruleLabel || humanizeSettingsAnomalyLabel(row.ruleKey) || "Anomaly exception";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
  };
  const renderActiveAnomalyGroups = (rows: SuspectedAnomalyRow[]) => {
    if (!rows.length)
      return <p className="text-xs text-muted-foreground">No anomalies in this tab.</p>;
    return (
      <div className="space-y-3">
        {groupActive(rows).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-3 py-2">
              <h4 className="text-sm font-semibold">{group.title}</h4>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div
                  key={row.signature}
                  className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[1.2fr_2fr_1.6fr]"
                >
                  <div>
                    <span className="font-semibold">{row.fileRef}</span>
                    <span className="mt-1 block text-muted-foreground">{row.division || "-"}</span>
                    <span className="block text-muted-foreground">{row.block}</span>
                  </div>
                  <div>
                    <div>
                      {row.previousField || "Expected"}: {row.previousDate || "-"}
                    </div>
                    <div>
                      {row.laterField || "Found"}: {row.laterDate || "-"}
                    </div>
                    {row.userExplanation ? (
                      <div className="mt-1 text-muted-foreground">
                        Message from {row.requestedByName || "User"}: {row.userExplanation}
                      </div>
                    ) : null}
                    {row.adminMessage ? (
                      <div className="mt-1 font-medium text-destructive">
                        Message to User: {row.adminMessage}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-1">
                    {row.requestStatus ? (
                      <span className="rounded border border-border px-2 py-1 font-medium">
                        {formatStatus(row.requestStatus)}
                      </span>
                    ) : null}
                    <HelpedControl
                      helper={settingsControlHelpers.anomalyFileAccept}
                      label="File anomaly acceptance help"
                    >
                      <button
                        type="button"
                        onClick={() => void review(row.signature, "approve_file")}
                        className="rounded border border-border px-2 py-1 hover:bg-accent"
                      >
                        File
                      </button>
                    </HelpedControl>
                    <HelpedControl
                      helper={settingsControlHelpers.anomalyUniversalAccept}
                      label="Universal anomaly acceptance help"
                    >
                      <button
                        type="button"
                        onClick={() => void review(row.signature, "approve_universal")}
                        className="rounded border border-border px-2 py-1 hover:bg-accent"
                      >
                        Universal
                      </button>
                    </HelpedControl>
                    <HelpedControl
                      helper={settingsControlHelpers.anomalyReject}
                      label="Send anomaly correction help"
                    >
                      <button
                        type="button"
                        onClick={() => void review(row.signature, "reject")}
                        className="rounded border border-border px-2 py-1 hover:bg-accent"
                      >
                        Send correction to user
                      </button>
                    </HelpedControl>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };
  const renderHistoryGroups = () => {
    if (!decisionAnomalies.length)
      return <p className="text-xs text-muted-foreground">No anomalies in this tab.</p>;
    return (
      <div className="space-y-3">
        {groupHistory(decisionAnomalies).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-3 py-2">
              <h4 className="text-sm font-semibold">{group.title}</h4>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => {
                const summary = anomalySummary(row);
                return (
                  <div
                    key={row.signature}
                    className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[1.1fr_2fr_1fr_1fr]"
                  >
                    <div className="flex items-start gap-2">
                      {canClearDecisionRows ? (
                        <input
                          type="checkbox"
                          checked={selectedDecisionSet.has(row.signature)}
                          onChange={() => toggleDecisionSignature(row.signature)}
                          className="mt-0.5"
                          aria-label={`Select ${row.fileRef || "anomaly"}`}
                        />
                      ) : null}
                      <span className="font-semibold">
                        {row.fileRef || "File reference not available"}
                      </span>
                    </div>
                    <div>
                      {summary.detail ? <div>{summary.detail}</div> : null}
                      {row.reason ? (
                        <div className="mt-1 text-muted-foreground">
                          Message from {row.requestedByName || "User"}: {row.reason}
                        </div>
                      ) : null}
                      {row.adminMessage ? (
                        <div className="mt-1 font-medium text-destructive">
                          Message to User: {row.adminMessage}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="font-medium">{formatStatus(row.status)}</div>
                      <div className="text-muted-foreground">
                        {row.reviewedByName || row.revokedByName || row.requestedByName || "-"}
                      </div>
                      <div className="text-muted-foreground">
                        {(row.reviewedAt || row.revokedAt || row.requestedAt || "").slice(0, 10)}
                      </div>
                    </div>
                    <div>
                      {row.status === "approved_file" || row.status === "approved_universal" ? (
                        <HelpedControl
                          helper={settingsControlHelpers.anomalyRevoke}
                          label="Revoke anomaly decision help"
                        >
                          <button
                            type="button"
                            onClick={() => void review(row.signature, "revoke")}
                            className="rounded border border-border px-2 py-1 hover:bg-accent"
                          >
                            Revoke
                          </button>
                        </HelpedControl>
                      ) : null}
                      {canClearDecisionRows ? (
                        <HelpedControl
                          helper={settingsControlHelpers.anomalyClear}
                          label="Clear anomaly history help"
                        >
                          <button
                            type="button"
                            onClick={() => void clearSelected([row.signature])}
                            className="rounded border border-border px-2 py-1 text-destructive hover:bg-destructive/10"
                          >
                            Clear
                          </button>
                        </HelpedControl>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-sm font-semibold">Anomaly Control</h2>
        <p className="text-sm text-muted-foreground">
          Review user acceptance requests, approve file-specific or universal exceptions, and manage
          custom anomaly rules.
        </p>
      </div>
      {message ? (
        <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
          {message}
        </p>
      ) : null}
      {loading ? <p className="text-xs text-muted-foreground">Loading anomaly control...</p> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">Anomaly workflow</h3>
            <SettingsHelper
              items={settingsControlHelpers.anomalyWorkflow}
              label="Anomaly workflow help"
            />
          </span>
          <HelpedControl helper={settingsControlHelpers.anomalyRefresh} label="Refresh anomaly help">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              Refresh
            </button>
          </HelpedControl>
        </div>
        <div className="flex flex-wrap gap-2">
          {workflowTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setWorkflowTab(tab.key)}
              className={
                "rounded-md border px-3 py-1.5 text-xs font-semibold " +
                (workflowTab === tab.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent")
              }
            >
              {tab.label} ({tab.count})
            </button>
          ))}
          {canClearDecisionRows && selectedDecisionSignatures.length ? (
            <HelpedControl
              helper={settingsControlHelpers.anomalyClear}
              label="Clear selected anomaly history help"
            >
              <button
                type="button"
                onClick={() => void clearSelected(selectedDecisionSignatures)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                Clear selected ({selectedDecisionSignatures.length})
              </button>
            </HelpedControl>
          ) : null}
        </div>
        {workflowTab === "current"
          ? renderActiveAnomalyGroups(currentAnomalies)
          : workflowTab === "sent"
            ? renderActiveAnomalyGroups(sentAnomalies)
            : renderHistoryGroups()}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Custom anomaly rules</h3>
          <HelpedControl helper={settingsControlHelpers.anomalyRuleAdd} label="Add anomaly rule help">
            <button
              type="button"
              onClick={() => void createRule()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              <Plus className="size-3.5" /> Add rule
            </button>
          </HelpedControl>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.length ? (
                rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{rule.name}</td>
                    <td className="px-3 py-2">{rule.ruleType}</td>
                    <td className="px-3 py-2">
                      {fieldLabel(rule.fieldA)} {rule.operator}{" "}
                      {rule.ruleType === "date_boundary"
                        ? rule.fixedValue
                        : fieldLabel(rule.fieldB)}
                      {rule.thresholdDays !== undefined ? ` (${rule.thresholdDays} days)` : ""}
                    </td>
                    <td className="px-3 py-2">{rule.severity}</td>
                    <td className="px-3 py-2">{rule.enabled ? "Enabled" : "Disabled"}</td>
                    <td className="px-3 py-2">
                      <HelpedControl
                        helper={settingsControlHelpers.anomalyRuleToggle}
                        label={`${rule.name} rule status help`}
                      >
                        <button
                          type="button"
                          onClick={() => void toggleRule(rule)}
                          className="rounded border border-border px-2 py-1 hover:bg-accent"
                        >
                          {rule.enabled ? "Disable" : "Enable"}
                        </button>
                      </HelpedControl>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                    No custom rules configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MilestoneSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const milestones = appendFileClosedMilestone(
    settings.milestones && settings.milestones.length > 0
      ? settings.milestones
      : defaultMilestoneSequence,
  );
  const [protectedMilestoneKeys] = useState(
    () => new Set(milestones.map((milestone) => normalizeMilestoneName(milestone))),
  );
  const [position, setPosition] = useState(String(milestones.length + 1));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateMilestones = (next: string[]) => {
    store.updateSettings({ milestones: next });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = milestones.some(
      (milestone) => milestone.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setName("");
      return;
    }
    const insertIndex = Math.max(0, Math.min(Number(position) - 1, milestones.length));
    updateMilestones([
      ...milestones.slice(0, insertIndex),
      trimmed,
      ...milestones.slice(insertIndex),
    ]);
    setName("");
    setPosition(String(milestones.length + 2));
  };

  const remove = (milestone: string) => {
    updateMilestones(milestones.filter((item) => item !== milestone));
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= milestones.length) return;
    const next = [...milestones];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateMilestones(next);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Milestones</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add milestone names and place them at the required sequence in the workflow.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_170px_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="Milestone name" />
        <label className="block">
          <div className="text-xs font-medium mb-1.5">Position</div>
          <select
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            {Array.from({ length: milestones.length + 1 }, (_, index) => (
              <option key={index + 1} value={String(index + 1)}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          className="h-10 self-end px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {milestones.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No milestone names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {milestones.map((milestone, index) => (
              <li key={milestone} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-secondary text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium">{milestone}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label={`Move ${milestone} up`}
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === milestones.length - 1}
                    className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label={`Move ${milestone} down`}
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  {protectedMilestoneKeys.has(normalizeMilestoneName(milestone)) ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
                      Existing
                    </span>
                  ) : (
                    <HelpedControl
                      helper={settingsControlHelpers.genericDelete}
                      label={`Delete ${milestone} help`}
                    >
                      <button
                        type="button"
                        onClick={() => remove(milestone)}
                        className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${milestone}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </HelpedControl>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TableFieldPresetSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const presets = settings.tableFieldPresets ?? [];
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const selectedPresetEditable =
    activeUser?.role === "admin" || selectedPreset?.owner === "personal";
  const selectedFieldKeys = selectedPreset?.fieldKeys ?? [];
  const allFieldKeys = tableFieldPresetGroups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );

  useEffect(() => {
    if (!selectedPreset && presets[0]) setSelectedPresetId(presets[0].id);
  }, [presets, selectedPreset]);

  const updatePresets = (next: TableFieldPreset[]) => {
    store.updateSettings({ tableFieldPresets: next });
  };

  const updateSelectedPreset = (patch: Partial<TableFieldPreset>) => {
    if (!selectedPreset || !selectedPresetEditable) return;
    updatePresets(
      presets.map((preset) => (preset.id === selectedPreset.id ? { ...preset, ...patch } : preset)),
    );
  };

  const addPreset = () => {
    const nextPreset: TableFieldPreset = {
      id: crypto.randomUUID(),
      name: `Preset ${presets.length + 1}`,
      fieldKeys: ["division", "indentor", "demandDescription"],
      owner: activeUser?.role === "admin" ? "global" : "personal",
      ownerUserId: activeUser?.role === "admin" ? undefined : activeUser?.id,
    };
    updatePresets([...presets, nextPreset]);
    setSelectedPresetId(nextPreset.id);
  };

  const removePreset = () => {
    if (!selectedPreset || !selectedPresetEditable) return;
    const next = presets.filter((preset) => preset.id !== selectedPreset.id);
    updatePresets(next);
    setSelectedPresetId(next[0]?.id ?? "");
  };

  const toggleField = (fieldKey: string) => {
    if (!selectedPreset || !selectedPresetEditable) return;
    updateSelectedPreset({
      fieldKeys: selectedFieldKeys.includes(fieldKey)
        ? selectedFieldKeys.filter((key) => key !== fieldKey)
        : [...selectedFieldKeys, fieldKey],
    });
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Preset table fields</h2>
          <p className="text-xs text-muted-foreground">
            Shared presets are set by admin and visible to all. Add personal presets visible only to
            your own login.
          </p>
        </div>
        <button
          type="button"
          onClick={addPreset}
          className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add preset
        </button>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No presets added yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-secondary/20 p-2">
            <div className="space-y-1">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPresetId(preset.id)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                    (selectedPreset?.id === preset.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{preset.name}</span>
                    {preset.owner === "global" && activeUser?.role !== "admin" ? (
                      <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        Shared
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedPreset ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1">
                  <div className="text-xs font-medium mb-1.5">Preset name</div>
                  <input
                    value={selectedPreset.name}
                    onChange={(event) => updateSelectedPreset({ name: event.target.value })}
                    disabled={!selectedPresetEditable}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: allFieldKeys })}
                  disabled={!selectedPresetEditable}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: [] })}
                  disabled={!selectedPresetEditable}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Clear
                </button>
                <HelpedControl
                  helper={settingsControlHelpers.genericDelete}
                  label="Delete table preset help"
                >
                  <button
                    type="button"
                    onClick={removePreset}
                    disabled={!selectedPresetEditable}
                    className="h-10 rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </HelpedControl>
              </div>
              {!selectedPresetEditable ? (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  This shared preset is managed by admin. Add a preset to create your own editable
                  version.
                </div>
              ) : null}

              <div className="space-y-4">
                {tableFieldPresetGroups.map((group) => (
                  <section
                    key={group.title}
                    className="rounded-md border border-border bg-secondary/20 p-3"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.fields.map((field) => (
                        <label
                          key={field.key}
                          className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFieldKeys.includes(field.key)}
                            onChange={() => toggleField(field.key)}
                            disabled={!selectedPresetEditable}
                            className="size-4 rounded border-input"
                          />
                          <span>{field.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DemandProcessingPresetSettings() {
  const settings = useSettings();
  const presets = normalizeDemandProcessingPresets(settings.demandProcessingPresets);
  const dayRanges = normalizeDemandProcessingDayRanges(settings.demandProcessingDayRanges);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];

  useEffect(() => {
    if (!selectedPreset && presets[0]) setSelectedPresetId(presets[0].id);
  }, [presets, selectedPreset]);

  const updatePresets = (next: DemandProcessingPreset[]) => {
    store.updateSettings({ demandProcessingPresets: next });
  };

  const updateSelectedPreset = (patch: Partial<DemandProcessingPreset>) => {
    if (!selectedPreset) return;
    updatePresets(
      presets.map((preset) => (preset.id === selectedPreset.id ? { ...preset, ...patch } : preset)),
    );
  };

  const addPreset = () => {
    const nextPreset: DemandProcessingPreset = {
      id: crypto.randomUUID(),
      name: `Demand processing preset ${presets.length + 1}`,
      fromFieldId: "file.immsDate",
      toFieldId: "order.soDate",
      active: true,
    };
    updatePresets([...presets, nextPreset]);
    setSelectedPresetId(nextPreset.id);
  };

  const removePreset = () => {
    if (!selectedPreset) return;
    const next = presets.filter((preset) => preset.id !== selectedPreset.id);
    updatePresets(next);
    setSelectedPresetId(next[0]?.id ?? "");
  };
  const updateDayRanges = (next: DemandProcessingDayRange[]) => {
    store.updateSettings({ demandProcessingDayRanges: normalizeDemandProcessingDayRanges(next) });
  };
  const updateDayRange = (id: string, patch: Partial<DemandProcessingDayRange>) => {
    updateDayRanges(dayRanges.map((range) => (range.id === id ? { ...range, ...patch } : range)));
  };
  const addDayRange = () => {
    updateDayRanges([
      ...dayRanges,
      {
        id: crypto.randomUUID(),
        label: `Range ${dayRanges.length + 1}`,
        minDays: "",
        maxDays: "",
      },
    ]);
  };
  const removeDayRange = (id: string) => {
    updateDayRanges(dayRanges.filter((range) => range.id !== id));
  };
  const resetDayRanges = () => updateDayRanges(defaultDemandProcessingDayRanges);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold mb-1">Demand processing presets</h2>
            <p className="text-xs text-muted-foreground">
              Create shared presets for the Demand processing analysis report.
            </p>
          </div>
          <button
            type="button"
            onClick={addPreset}
            className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add preset
          </button>
        </div>

        {presets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No custom presets added yet. Built-in presets are always available in Reports.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="rounded-md border border-border bg-secondary/20 p-2">
              <div className="space-y-1">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={
                      "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                      (selectedPreset?.id === preset.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{preset.name}</span>
                      {preset.active === false ? (
                        <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          Hidden
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {selectedPreset ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <span>Preset name</span>
                    <input
                      value={selectedPreset.name}
                      onChange={(event) => updateSelectedPreset({ name: event.target.value })}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </label>
                  <label className="flex h-10 items-center gap-2 self-end rounded-md border border-input bg-background px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedPreset.active !== false}
                      onChange={(event) => updateSelectedPreset({ active: event.target.checked })}
                      className="size-4 rounded border-input"
                    />
                    Visible
                  </label>
                  <HelpedControl
                    helper={settingsControlHelpers.genericDelete}
                    label="Delete demand processing preset help"
                  >
                    <button
                      type="button"
                      onClick={removePreset}
                      className="h-10 self-end rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </HelpedControl>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <SettingsDemandDateSelector
                    label="From date"
                    value={selectedPreset.fromFieldId}
                    onChange={(fromFieldId) => updateSelectedPreset({ fromFieldId })}
                  />
                  <SettingsDemandDateSelector
                    label="To date"
                    value={selectedPreset.toFieldId}
                    onChange={(toFieldId) => updateSelectedPreset({ toFieldId })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <DemandProcessingDayRangeSettings
        ranges={dayRanges}
        onAdd={addDayRange}
        onReset={resetDayRanges}
        onUpdate={updateDayRange}
        onRemove={removeDayRange}
      />
    </div>
  );
}

function SettingsDemandDateSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const selectedField = getDemandProcessingField(value);
  return (
    <div className="rounded-md border border-border bg-secondary/20">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}: <span className="text-foreground">{selectedField?.label ?? "Select date"}</span>
      </div>
      <div className="max-h-80 overflow-y-auto p-2">
        {getDemandProcessingFieldGroups().map((group) => (
          <details key={`${label}:${group.title}`} className="rounded-md">
            <summary className="cursor-pointer rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground">
              {group.title}
            </summary>
            <div className="space-y-1 pb-2 pl-2">
              {group.fields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => onChange(field.id)}
                  className={
                    "block w-full rounded px-2 py-1.5 text-left text-sm transition " +
                    (value === field.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {field.label}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

const defaultDemandProcessingDayRanges: DemandProcessingDayRange[] = [
  { id: "0-90", label: "0-90", minDays: "0", maxDays: "90" },
  { id: "91-180", label: "91-180", minDays: "91", maxDays: "180" },
  { id: "181-365", label: "181-365", minDays: "181", maxDays: "365" },
  { id: "365-plus", label: "365 and above", minDays: "366", maxDays: "" },
];

function normalizeDemandProcessingDayRanges(value: unknown): DemandProcessingDayRange[] {
  if (!Array.isArray(value)) return defaultDemandProcessingDayRanges;
  const ranges = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const label = String(record.label ?? "").trim();
      if (!label) return undefined;
      return {
        id: String(record.id ?? crypto.randomUUID()),
        label,
        minDays: String(record.minDays ?? "").trim(),
        maxDays: String(record.maxDays ?? "").trim(),
      };
    })
    .filter((range): range is DemandProcessingDayRange => Boolean(range));
  return ranges.length ? ranges : defaultDemandProcessingDayRanges;
}

function DemandProcessingDayRangeSettings({
  ranges,
  onAdd,
  onReset,
  onUpdate,
  onRemove,
}: {
  ranges: DemandProcessingDayRange[];
  onAdd: () => void;
  onReset: () => void;
  onUpdate: (id: string, patch: Partial<DemandProcessingDayRange>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Demand processing day ranges</h2>
          <p className="text-xs text-muted-foreground">
            Configure gap buckets used in Demand processing analysis.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReset}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add range
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {ranges.map((range) => (
          <div
            key={range.id}
            className="grid grid-cols-1 gap-2 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[minmax(180px,1fr)_120px_120px_80px]"
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Label</span>
              <input
                value={range.label}
                onChange={(event) => onUpdate(range.id ?? "", { label: event.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Min days</span>
              <input
                type="number"
                value={range.minDays ?? ""}
                onChange={(event) => onUpdate(range.id ?? "", { minDays: event.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Max days</span>
              <input
                type="number"
                value={range.maxDays ?? ""}
                onChange={(event) => onUpdate(range.id ?? "", { maxDays: event.target.value })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <div className="flex items-end">
              <HelpedControl
                helper={settingsControlHelpers.genericDelete}
                label="Delete day range help"
              >
                <button
                  type="button"
                  onClick={() => onRemove(range.id ?? "")}
                  className="h-9 w-full rounded-md border border-destructive/40 bg-background px-2 text-xs text-destructive hover:bg-destructive/10"
                >
                  Delete
                </button>
              </HelpedControl>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MmgSummarySettings() {
  const settings = useSettings();
  const fields = normalizeMmgSummaryFields(
    settings.mmgSummaryFields,
    settings.modes,
    settings.firmTypes,
    settings.fileTypes,
  );
  const mmgSummaryFieldOptions = getMmgSummaryFieldOptions(
    settings.modes,
    settings.firmTypes,
    settings.fileTypes,
    fields,
  );
  const optionGroups = Array.from(new Set(mmgSummaryFieldOptions.map((option) => option.group)));

  const updateFields = (nextFields: typeof fields) => {
    store.updateSettings({ mmgSummaryFields: nextFields });
  };

  const updateField = (key: string, patch: Partial<(typeof fields)[number]>) => {
    updateFields(fields.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">MMG Summary</h2>
          <p className="text-xs text-muted-foreground">
            Choose fields and edit labels for the MMG Summary report export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => updateFields(fields.map((field) => ({ ...field, enabled: true })))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => updateFields(fields.map((field) => ({ ...field, enabled: false })))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() =>
              updateFields(
                normalizeMmgSummaryFields(
                  [],
                  settings.modes,
                  settings.firmTypes,
                  settings.fileTypes,
                ),
              )
            }
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Reset labels
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {optionGroups.map((group) => {
          const groupOptions = mmgSummaryFieldOptions.filter((option) => option.group === group);
          return (
            <section key={group} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {groupOptions.map((option) => {
                  const field = fields.find((item) => item.key === option.key) ?? {
                    key: option.key,
                    label: option.label,
                    enabled: true,
                  };
                  return (
                    <div
                      key={option.key}
                      className="grid gap-2 rounded-md border border-input bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={(event) =>
                            updateField(option.key, { enabled: event.target.checked })
                          }
                          className="size-4 rounded border-input"
                        />
                        <span>{option.label}</span>
                      </label>
                      <label className="text-xs text-muted-foreground">
                        <span className="mb-1 block">Export label</span>
                        <input
                          value={field.label}
                          onChange={(event) =>
                            updateField(option.key, { label: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DivisionSettings() {
  const divisions = useDivisions();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [ad, setAd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editAd, setEditAd] = useState("");
  const [editMessagesEnabled, setEditMessagesEnabled] = useState(true);
  const [editViewerPassword, setEditViewerPassword] = useState("");

  const add = () => {
    if (!name.trim()) return;
    store.addDivision(name.trim(), code.trim() || undefined, undefined, undefined, ad);
    setName("");
    setCode("");
    setAd("");
  };

  const startEdit = (division: (typeof divisions)[number]) => {
    setEditingId(division.id);
    setEditName(division.name);
    setEditCode(division.code ?? "");
    setEditAd(division.ad ?? "");
    setEditMessagesEnabled(division.messagesEnabled !== false);
    setEditViewerPassword("");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    store.updateDivision(id, {
      name: editName.trim(),
      code: editCode.trim() || undefined,
      ad: editAd,
      messagesEnabled: editMessagesEnabled,
      ...(editViewerPassword.trim() ? { viewerPassword: editViewerPassword.trim() } : {}),
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Divisions</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Use this page for the master list of division names, codes, AD marking, and viewer
        passwords. Deleting a division sends it to Archive for recovery. Year-wise activation,
        yearly funds, and merged/continued division work are handled in Year Setup.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.7fr_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="Division name" />
        <DivisionInput value={code} onChange={setCode} placeholder="Division code" />
        <DivisionAdSelect value={ad} onChange={setAd} />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Division name</th>
              <th className="text-left font-medium px-4 py-2.5">Division code</th>
              <th className="text-left font-medium px-4 py-2.5">AD</th>
              <th className="text-left font-medium px-4 py-2.5">Messages</th>
              <th className="text-left font-medium px-4 py-2.5">Viewer password</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((division) => {
              const isEditing = editingId === division.id;
              const editChanged =
                editName.trim() !== division.name ||
                editCode.trim() !== (division.code ?? "") ||
                editAd !== (division.ad ?? "") ||
                editMessagesEnabled !== (division.messagesEnabled !== false) ||
                Boolean(editViewerPassword.trim());
              return (
                <tr key={division.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <DivisionInput
                        value={editName}
                        onChange={setEditName}
                        placeholder="Division name"
                      />
                    ) : (
                      <span className="font-medium">{division.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editCode}
                        onChange={setEditCode}
                        placeholder="Division code"
                      />
                    ) : (
                      division.code || "Not set"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionAdSelect value={editAd} onChange={setEditAd} />
                    ) : (
                      division.ad || "No"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editMessagesEnabled}
                          onChange={(event) => setEditMessagesEnabled(event.target.checked)}
                          className="size-4"
                        />
                        <span>{editMessagesEnabled ? "Active" : "Inactive"}</span>
                      </label>
                    ) : division.messagesEnabled === false ? (
                      "Inactive"
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editViewerPassword}
                        onChange={setEditViewerPassword}
                        placeholder="New viewer password"
                      />
                    ) : (
                      "Set while editing"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(division.id)}
                            disabled={!editChanged || !editName.trim()}
                            className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="size-8 grid place-items-center rounded-md hover:bg-accent"
                          >
                            <X className="size-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(division)}
                            className="size-8 grid place-items-center rounded-md hover:bg-accent"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <HelpedControl
                            helper={settingsControlHelpers.genericDelete}
                            label={`Delete ${division.name} help`}
                          >
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  await requestDeletionPassword(`delete division "${division.name}"`)
                                ) {
                                  store.deleteDivision(division.id);
                                }
                              }}
                              className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </HelpedControl>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type IndentorDraft = Pick<
  Indentor,
  "divisionId" | "name" | "sfId" | "designation" | "mobileNo" | "landlineNo" | "email"
>;

type FirmDraft = Pick<
  MasterFirm,
  "firmName" | "emailId" | "city" | "address" | "firmUniqueNo" | "contactNo"
>;

const emptyFirmDraft: FirmDraft = {
  firmName: "",
  emailId: "",
  city: "",
  address: "",
  firmUniqueNo: "",
  contactNo: "",
};

function cleanFirmDraft(draft: FirmDraft): FirmDraft {
  return {
    firmName: draft.firmName?.trim() || "",
    emailId: draft.emailId?.trim() || "",
    city: draft.city?.trim() || "",
    address: draft.address?.trim() || "",
    firmUniqueNo: draft.firmUniqueNo?.trim() || "",
    contactNo: draft.contactNo?.trim() || "",
  };
}

function numericOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isValidEmailFormat(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function FirmRatingSettings() {
  const settings = useSettings();
  const config = normalizeFirmRatingConfig(settings.firmRatingConfig);

  const updateFields = (fields: FirmRatingConfig["fields"]) => {
    store.updateSettings({ firmRatingConfig: normalizeFirmRatingConfig({ fields }) });
  };

  const updateField = (index: number, patch: Partial<FirmRatingConfig["fields"][number]>) => {
    updateFields(
      config.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    );
  };

  const addField = () => {
    updateFields([
      ...config.fields,
      {
        id: `rating${config.fields.length + 1}`,
        label: `Rating ${config.fields.length + 1}`,
        weight: "1",
      },
    ]);
  };

  const removeField = (index: number) => {
    updateFields(config.fields.filter((_field, fieldIndex) => fieldIndex !== index));
  };

  const resetFields = () => {
    updateFields(defaultFirmRatingFields);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Firm Rating</h2>
          <p className="text-xs text-muted-foreground">
            Configure the score fields used for every supply order. Final score is calculated as a
            weighted average of filled numeric values.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addField}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Add field
          </button>
          <button
            type="button"
            onClick={resetFields}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {config.fields.map((field, index) => (
          <div
            key={`${field.id}:${index}`}
            className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]"
          >
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Field label</span>
              <input
                value={field.label}
                onChange={(event) => updateField(index, { label: event.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Weight</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={field.weight ?? "1"}
                onChange={(event) => updateField(index, { weight: event.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <button
              type="button"
              onClick={() => removeField(index)}
              disabled={config.fields.length <= 1}
              className="h-9 self-end rounded-md border border-border bg-background px-3 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FirmDatabaseSettings() {
  const activeUser = useActiveUser();
  const settings = useSettings();
  const canManage =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const canDeleteFirms = activeUser?.role === "admin" || activeUser?.role === "sub_admin";
  const [draft, setDraft] = useState<FirmDraft>(emptyFirmDraft);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [firms, setFirms] = useState<MasterFirm[]>([]);
  const [firmTotal, setFirmTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FirmDraft>(emptyFirmDraft);
  const [labelDraft, setLabelDraft] = useState(settings.firmUniqueNoLabel || "Firm Unique No.");
  const firmUniqueNoLabel = settings.firmUniqueNoLabel || "Firm Unique No.";
  const firmUniqueNoLabelChanged = (labelDraft.trim() || "Firm Unique No.") !== firmUniqueNoLabel;

  useEffect(() => {
    setLabelDraft(firmUniqueNoLabel);
  }, [firmUniqueNoLabel]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const loadFirms = () => {
    setLoading(true);
    setMessage(undefined);
    fetchMasterFirms({ q: debouncedSearch, page, pageSize })
      .then((result) => {
        setFirms(result.firms);
        setFirmTotal(result.total);
        if (result.page !== page) setPage(result.page);
        if (result.pageSize !== pageSize) setPageSize(result.pageSize);
      })
      .catch((error) => {
        console.error(error);
        setMessage(error instanceof Error ? error.message : "Failed to load firms.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFirms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(firmTotal / pageSize));
  const firstResultNumber = firmTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResultNumber = Math.min(firmTotal, (page - 1) * pageSize + firms.length);
  const isComplete = (value: FirmDraft) => {
    const cleaned = cleanFirmDraft(value);
    return Boolean(cleaned.firmName || cleaned.emailId || cleaned.firmUniqueNo);
  };

  const updateDraft = (key: keyof FirmDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const updateEditDraft = (key: keyof FirmDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };

  const addFirm = async () => {
    const cleaned = cleanFirmDraft(draft);
    if (!canManage || !isComplete(cleaned)) return;
    if (!isValidEmailFormat(cleaned.emailId)) {
      setMessage("Enter a valid email id.");
      return;
    }
    try {
      await createMasterFirm(cleaned);
      setDraft(emptyFirmDraft);
      setPage(1);
      loadFirms();
      setMessage("Firm added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add firm.");
    }
  };

  const startEdit = (firm: MasterFirm) => {
    setEditingId(firm.id);
    setEditDraft({
      firmName: firm.firmName ?? "",
      emailId: firm.emailId ?? "",
      city: firm.city ?? "",
      address: firm.address ?? "",
      firmUniqueNo: firm.firmUniqueNo ?? "",
      contactNo: firm.contactNo ?? "",
    });
  };

  const saveEdit = async (id: string) => {
    const cleaned = cleanFirmDraft(editDraft);
    if (!canManage || !isComplete(cleaned)) return;
    if (!isValidEmailFormat(cleaned.emailId)) {
      setMessage("Enter a valid email id.");
      return;
    }
    try {
      await updateMasterFirm(id, cleaned);
      setEditingId(null);
      loadFirms();
      setMessage("Firm updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update firm.");
    }
  };

  const removeFirm = async (id: string) => {
    if (!canDeleteFirms) return;
    try {
      await deleteMasterFirm(id);
      if (firms.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        loadFirms();
      }
      setMessage("Firm deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete firm.");
    }
  };

  const saveFirmUniqueNoLabel = async () => {
    if (activeUser?.role !== "admin") return;
    await store.updateSettings({ firmUniqueNoLabel: labelDraft.trim() || "Firm Unique No." });
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Firm Database</h2>
          <p className="text-xs text-muted-foreground">
            Save reusable firm records for future file firm details.
          </p>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search firm, email, ${firmUniqueNoLabel}`}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 sm:max-w-md"
        />
      </div>

      {activeUser?.role === "admin" ? (
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <DivisionInput
            value={labelDraft}
            onChange={setLabelDraft}
            placeholder="Firm Unique No. label"
          />
          <button
            type="button"
            onClick={() => void saveFirmUniqueNoLabel()}
            disabled={!firmUniqueNoLabelChanged}
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-4" /> Save label
          </button>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_0.85fr_1fr_1fr_0.8fr_0.9fr_auto]">
        <DivisionInput
          value={draft.firmName ?? ""}
          onChange={(value) => updateDraft("firmName", value)}
          placeholder="Firm name"
        />
        <DivisionInput
          value={draft.firmUniqueNo ?? ""}
          onChange={(value) => updateDraft("firmUniqueNo", value)}
          placeholder={firmUniqueNoLabel}
        />
        <FirmInput
          value={draft.emailId ?? ""}
          onChange={(value) => updateDraft("emailId", value)}
          placeholder="Email id"
          type="email"
          invalid={!isValidEmailFormat(draft.emailId)}
        />
        <DivisionInput
          value={draft.address ?? ""}
          onChange={(value) => updateDraft("address", value)}
          placeholder="Address"
        />
        <DivisionInput
          value={draft.city ?? ""}
          onChange={(value) => updateDraft("city", value)}
          placeholder="City"
        />
        <FirmInput
          value={draft.contactNo ?? ""}
          onChange={(value) => updateDraft("contactNo", numericOnly(value))}
          placeholder="Contact No."
          type="tel"
        />
        <button
          type="button"
          onClick={() => void addFirm()}
          disabled={!canManage || !isComplete(draft)}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" /> Add firm
        </button>
      </div>

      {message ? (
        <div className="mt-4 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}

      <SettingsPaginationControls
        firstResultNumber={firstResultNumber}
        lastResultNumber={lastResultNumber}
        total={firmTotal}
        itemLabel="firms"
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1360px] table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[13%]" />
            <col className="w-[16%]" />
            <col className="w-[21%]" />
            <col className="w-[12%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Firm name</th>
              <th className="px-4 py-2.5 text-left font-medium">{firmUniqueNoLabel}</th>
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-4 py-2.5 text-left font-medium">Address</th>
              <th className="px-4 py-2.5 text-left font-medium">City</th>
              <th className="px-4 py-2.5 text-left font-medium">Contact No.</th>
              <th className="px-4 py-2.5 text-left font-medium">Rating</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {firms.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={8}>
                  {loading ? "Loading firms..." : "No firms found."}
                </td>
              </tr>
            ) : (
              firms.map((firm) => {
                const isEditing = editingId === firm.id;
                const editChanged = !isSettingsDirtyValueEqual(cleanFirmDraft(editDraft), {
                  firmName: firm.firmName ?? "",
                  emailId: firm.emailId ?? "",
                  city: firm.city ?? "",
                  address: firm.address ?? "",
                  firmUniqueNo: firm.firmUniqueNo ?? "",
                  contactNo: firm.contactNo ?? "",
                });
                return (
                  <tr key={firm.id} className="border-t border-border align-top">
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.firmName : firm.firmName}
                      onChange={(value) => updateEditDraft("firmName", value)}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.firmUniqueNo : firm.firmUniqueNo}
                      onChange={(value) => updateEditDraft("firmUniqueNo", value)}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.emailId : firm.emailId}
                      onChange={(value) => updateEditDraft("emailId", value)}
                      type="email"
                      invalid={!isValidEmailFormat(isEditing ? editDraft.emailId : firm.emailId)}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.address : firm.address}
                      onChange={(value) => updateEditDraft("address", value)}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.city : firm.city}
                      onChange={(value) => updateEditDraft("city", value)}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.contactNo : firm.contactNo}
                      onChange={(value) => updateEditDraft("contactNo", numericOnly(value))}
                      type="tel"
                    />
                    <td className="px-4 py-3 text-muted-foreground">
                      {firm.firmRating || "Not rated"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveEdit(firm.id)}
                              disabled={
                                !editChanged ||
                                !canManage ||
                                !isComplete(editDraft) ||
                                !isValidEmailFormat(editDraft.emailId)
                              }
                              className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(firm)}
                              disabled={!canManage}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Pencil className="size-4" />
                            </button>
                            {canDeleteFirms ? (
                              <HelpedControl
                                helper={settingsControlHelpers.genericDelete}
                                label={`Delete ${firm.firmName || "firm"} help`}
                              >
                                <button
                                  type="button"
                                  onClick={() => void removeFirm(firm.id)}
                                  className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </HelpedControl>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <SettingsPaginationControls
        className="mt-3"
        firstResultNumber={firstResultNumber}
        lastResultNumber={lastResultNumber}
        total={firmTotal}
        itemLabel="firms"
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />
    </div>
  );
}

function FirmCell({
  editing,
  value,
  onChange,
  type = "text",
  invalid = false,
}: {
  editing: boolean;
  value?: string;
  onChange: (value: string) => void;
  type?: string;
  invalid?: boolean;
}) {
  return (
    <td className="px-4 py-3 text-muted-foreground">
      {editing ? (
        <FirmInput
          value={value ?? ""}
          onChange={onChange}
          placeholder=""
          type={type}
          invalid={invalid}
        />
      ) : (
        value || "Not set"
      )}
    </td>
  );
}

function FirmInput({
  value,
  onChange,
  placeholder,
  type = "text",
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      type={type}
      inputMode={type === "tel" ? "numeric" : undefined}
      pattern={
        type === "tel" ? "[0-9]*" : type === "email" ? "[^\\s@]+@[^\\s@]+\\.[^\\s@]+" : undefined
      }
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={
        "w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" +
        (invalid ? " border-destructive" : "")
      }
    />
  );
}

function SettingsPaginationControls({
  firstResultNumber,
  lastResultNumber,
  total,
  itemLabel,
  page,
  totalPages,
  pageSize,
  className = "mt-5",
  onPageSizeChange,
  onPrevious,
  onNext,
}: {
  firstResultNumber: number;
  lastResultNumber: number;
  total: number;
  itemLabel: string;
  page: number;
  totalPages: number;
  pageSize: number;
  className?: string;
  onPageSizeChange: (pageSize: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className={
        className +
        " flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <span>
        {total
          ? `Showing ${firstResultNumber}-${lastResultNumber} of ${total} ${itemLabel}`
          : `No ${itemLabel}`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {settingsPageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrevious}
          className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={onNext}
          className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

const emptyIndentorDraft: IndentorDraft = {
  divisionId: "",
  name: "",
  sfId: "",
  designation: "",
  mobileNo: "",
  landlineNo: "",
  email: "",
};

const indentorDesignationOptions = [
  "TO 'A'",
  "TO 'B'",
  "TO 'C'",
  "TO 'D'",
  "Sc. B",
  "Sc. C",
  "Sc. D",
  "Sc. E",
  "Sc. F",
  "Sc. G",
  "Sc. H",
];

function IndentorSettings() {
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const canManage = activeUser?.role === "admin" || activeUser?.role === "sub_admin";
  const availableDivisions =
    !activeUser || canViewAllDivisions(activeUser.role)
      ? divisions
      : divisions.filter((division) => activeUser.divisionIds.includes(division.id));
  const [draft, setDraft] = useState<IndentorDraft>(emptyIndentorDraft);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [indentors, setIndentors] = useState<Indentor[]>([]);
  const [indentorTotal, setIndentorTotal] = useState(0);
  const [indentorsLoading, setIndentorsLoading] = useState(false);
  const [indentorsError, setIndentorsError] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<IndentorDraft>(emptyIndentorDraft);

  useEffect(() => {
    if (!draft.divisionId && availableDivisions[0]) {
      setDraft((current) => ({ ...current, divisionId: availableDivisions[0].id }));
    }
  }, [availableDivisions, draft.divisionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const loadIndentors = () => {
    setIndentorsLoading(true);
    setIndentorsError(undefined);
    fetchIndentors({
      divisionId: divisionFilter === "all" ? undefined : divisionFilter,
      q: debouncedSearch,
      page,
      pageSize,
    })
      .then((result) => {
        setIndentors(result.indentors);
        setIndentorTotal(result.total);
        if (result.page !== page) setPage(result.page);
        if (result.pageSize !== pageSize) setPageSize(result.pageSize);
      })
      .catch((error) => {
        console.error(error);
        setIndentorsError(error instanceof Error ? error.message : "Failed to load indentors.");
      })
      .finally(() => setIndentorsLoading(false));
  };

  useEffect(() => {
    loadIndentors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionFilter, debouncedSearch, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(indentorTotal / pageSize));
  const firstResultNumber = indentorTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResultNumber = Math.min(indentorTotal, (page - 1) * pageSize + indentors.length);

  const updateDraft = (key: keyof IndentorDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateEditDraft = (key: keyof IndentorDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };

  const isComplete = (value: IndentorDraft) =>
    value.divisionId &&
    value.name.trim() &&
    value.sfId.trim() &&
    value.designation.trim() &&
    value.mobileNo.trim() &&
    value.landlineNo.trim() &&
    value.email.trim();

  const resetDraft = () =>
    setDraft({ ...emptyIndentorDraft, divisionId: availableDivisions[0]?.id ?? "" });

  const addIndentor = async () => {
    if (!isComplete(draft)) return;
    if (
      activeUser?.role === "viewer" &&
      !window.confirm(
        "Please confirm all indentor details are correct. Once added by a viewer, these details cannot be edited or deleted by the viewer.",
      )
    ) {
      return;
    }
    await store.addIndentor({
      divisionId: draft.divisionId,
      name: draft.name.trim(),
      sfId: draft.sfId.trim(),
      designation: draft.designation.trim(),
      mobileNo: draft.mobileNo.trim(),
      landlineNo: draft.landlineNo.trim(),
      email: draft.email.trim(),
    });
    resetDraft();
    setPage(1);
    loadIndentors();
  };

  const startEdit = (indentor: Indentor) => {
    setEditingId(indentor.id);
    setEditDraft({
      divisionId: indentor.divisionId,
      name: indentor.name,
      sfId: indentor.sfId,
      designation: indentor.designation,
      mobileNo: indentor.mobileNo,
      landlineNo: indentor.landlineNo,
      email: indentor.email,
    });
  };

  const saveEdit = async (id: string) => {
    if (!isComplete(editDraft)) return;
    await store.updateIndentor(id, {
      divisionId: editDraft.divisionId,
      name: editDraft.name.trim(),
      sfId: editDraft.sfId.trim(),
      designation: editDraft.designation.trim(),
      mobileNo: editDraft.mobileNo.trim(),
      landlineNo: editDraft.landlineNo.trim(),
      email: editDraft.email.trim(),
    });
    setEditingId(null);
    loadIndentors();
  };

  const deleteIndentor = async (id: string) => {
    await store.deleteIndentor(id);
    if (indentors.length === 1 && page > 1) {
      setPage((current) => Math.max(1, current - 1));
    } else {
      loadIndentors();
    }
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Indentors</h2>
          <p className="text-xs text-muted-foreground">
            Add and search division-wise indentors used when files are created.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row">
          <select
            value={divisionFilter}
            onChange={(event) => {
              setDivisionFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="all">All divisions</option>
            {availableDivisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, SF ID, designation, email"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <IndentorDivisionSelect
          value={draft.divisionId}
          divisions={availableDivisions}
          disabled={availableDivisions.length <= 1}
          onChange={(value) => updateDraft("divisionId", value)}
        />
        <DivisionInput
          value={draft.name}
          onChange={(value) => updateDraft("name", value)}
          placeholder="Name"
        />
        <DivisionInput
          value={draft.sfId}
          onChange={(value) => updateDraft("sfId", value)}
          placeholder="SF ID"
        />
        <IndentorDesignationField
          value={draft.designation}
          onChange={(value) => updateDraft("designation", value)}
        />
        <DivisionInput
          value={draft.mobileNo}
          onChange={(value) => updateDraft("mobileNo", value)}
          placeholder="Mobile no."
        />
        <DivisionInput
          value={draft.landlineNo}
          onChange={(value) => updateDraft("landlineNo", value)}
          placeholder="Landline no."
        />
        <DivisionInput
          value={draft.email}
          onChange={(value) => updateDraft("email", value)}
          placeholder="Email id"
        />
        <button
          type="button"
          onClick={addIndentor}
          disabled={!isComplete(draft)}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" /> Add indentor
        </button>
      </div>

      <SettingsPaginationControls
        firstResultNumber={firstResultNumber}
        lastResultNumber={lastResultNumber}
        total={indentorTotal}
        itemLabel="indentors"
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1050px] table-fixed text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Division</th>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">SF ID</th>
              <th className="px-4 py-2.5 text-left font-medium">Designation</th>
              <th className="px-4 py-2.5 text-left font-medium">Mobile</th>
              <th className="px-4 py-2.5 text-left font-medium">Landline</th>
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {indentors.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={8}>
                  {indentorsLoading
                    ? "Loading indentors..."
                    : indentorsError
                      ? indentorsError
                      : "No indentors found."}
                </td>
              </tr>
            ) : (
              indentors.map((indentor) => {
                const isEditing = editingId === indentor.id;
                const editChanged = !isSettingsDirtyValueEqual(editDraft, {
                  divisionId: indentor.divisionId,
                  name: indentor.name,
                  sfId: indentor.sfId,
                  designation: indentor.designation,
                  mobileNo: indentor.mobileNo,
                  landlineNo: indentor.landlineNo,
                  email: indentor.email,
                });
                return (
                  <tr key={indentor.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <IndentorDivisionSelect
                          value={editDraft.divisionId}
                          divisions={divisions}
                          onChange={(value) => updateEditDraft("divisionId", value)}
                        />
                      ) : (
                        indentor.divisionName
                      )}
                    </td>
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.name : indentor.name}
                      onChange={(value) => updateEditDraft("name", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.sfId : indentor.sfId}
                      onChange={(value) => updateEditDraft("sfId", value)}
                    />
                    <IndentorDesignationCell
                      editing={isEditing}
                      value={isEditing ? editDraft.designation : indentor.designation}
                      onChange={(value) => updateEditDraft("designation", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.mobileNo : indentor.mobileNo}
                      onChange={(value) => updateEditDraft("mobileNo", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.landlineNo : indentor.landlineNo}
                      onChange={(value) => updateEditDraft("landlineNo", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.email : indentor.email}
                      onChange={(value) => updateEditDraft("email", value)}
                    />
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEdit(indentor.id)}
                                disabled={!editChanged || !isComplete(editDraft)}
                                className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Check className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="size-8 grid place-items-center rounded-md hover:bg-accent"
                              >
                                <X className="size-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(indentor)}
                                className="size-8 grid place-items-center rounded-md hover:bg-accent"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <HelpedControl
                                helper={settingsControlHelpers.genericDelete}
                                label={`Delete ${indentor.name} help`}
                              >
                                <button
                                  type="button"
                                  onClick={() => deleteIndentor(indentor.id)}
                                  className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </HelpedControl>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">View</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <SettingsPaginationControls
        className="mt-3"
        firstResultNumber={firstResultNumber}
        lastResultNumber={lastResultNumber}
        total={indentorTotal}
        itemLabel="indentors"
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />
    </div>
  );
}

function IpAccessSettings() {
  const [config, setConfig] = useState<IpAccessConfig | undefined>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [remarks, setRemarks] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const nextConfig = await store.getIpAccessConfig();
      setConfig(nextConfig);
      if (!ipAddress) setIpAddress(nextConfig.currentIp);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load IP access settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateMode = async (mode: IpAccessMode) => {
    if (
      mode === "restrict" &&
      !window.confirm(
        "Restrict mode blocks login from IPs that are not active in the trusted list. Continue?",
      )
    ) {
      return;
    }
    setConfig(await store.updateIpAccessMode(mode));
  };

  const addIp = async (value = ipAddress) => {
    if (!value.trim()) return;
    setConfig(await store.addTrustedIpAddress(value.trim(), remarks.trim()));
    setIpAddress("");
    setRemarks("");
  };

  const permanentlyDeleteArchivedAttempt = async (attempt: IpLoginAttempt) => {
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived IP attempt "${attempt.ipAddress}"`,
    );
    if (deletionPassword === null) return;
    try {
      setConfig(await store.permanentlyDeleteArchivedIpLoginAttempt(attempt.id, deletionPassword));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete archived IP attempt.");
    }
  };

  const activeAttempts = config?.attempts ?? [];
  const archivedAttempts = config?.archivedAttempts ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Login IP Access Control</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Monitor or restrict login based on trusted IP addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            Refresh
          </button>
        </div>

        {message ? (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message}
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="block">
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Mode
              <SettingsHelper items={settingsControlHelpers.ipMode} label="IP access mode help" />
            </div>
            <select
              value={config?.mode ?? "off"}
              onChange={(event) => void updateMode(event.target.value as IpAccessMode)}
              disabled={loading || !config}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="off">Off</option>
              <option value="notify">Notify on new IP</option>
              <option value="restrict">Restrict to trusted IPs</option>
            </select>
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                Current detected IP
                <SettingsHelper
                  items={settingsControlHelpers.ipCurrent}
                  label="Current detected IP help"
                />
              </div>
              <div className="mt-1 font-mono text-sm font-semibold">
                {config?.currentIp || "Not detected"}
              </div>
              {config?.emergencyBypassEnv ? (
                <div className="mt-1 text-xs text-destructive">
                  Emergency server bypass is active.
                </div>
              ) : null}
            </div>
            <HelpedControl helper={settingsControlHelpers.ipAddCurrent} label="Add current IP help">
              <button
                type="button"
                onClick={() => config?.currentIp && void addIp(config.currentIp)}
                disabled={!config?.currentIp}
                className="h-10 self-end rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Add current IP
              </button>
            </HelpedControl>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.5fr_auto]">
          <div className="flex items-center gap-1">
            <DivisionInput value={ipAddress} onChange={setIpAddress} placeholder="IP address" />
            <SettingsHelper items={settingsControlHelpers.ipManualAddress} label="IP address help" />
          </div>
          <div className="flex items-center gap-1">
            <DivisionInput value={remarks} onChange={setRemarks} placeholder="Remarks" />
            <SettingsHelper items={settingsControlHelpers.ipRemarks} label="IP remarks help" />
          </div>
          <HelpedControl helper={settingsControlHelpers.ipAddTrusted} label="Add trusted IP help">
            <button
              type="button"
              onClick={() => void addIp()}
              disabled={!ipAddress.trim()}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Add trusted IP
            </button>
          </HelpedControl>
        </div>
      </div>

      <TrustedIpTable
        rows={config?.trustedIps ?? []}
        onUpdate={async (id, patch) => setConfig(await store.updateTrustedIpAddress(id, patch))}
      />

      <IpAttemptTable
        title={`New IP login history (${activeAttempts.length})`}
        rows={activeAttempts}
        archived={false}
        onArchive={async (id) => setConfig(await store.archiveIpLoginAttempt(id))}
      />

      <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            New IP bin / archive ({archivedAttempts.length})
            <SettingsHelper items={settingsControlHelpers.ipAttemptBin} label="New IP archive help" />
          </span>
          <button
            type="button"
            onClick={() => setShowArchive((open) => !open)}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            {showArchive ? "Hide" : "Show"}
          </button>
        </div>
        {showArchive ? (
          <div className="mt-4">
            <IpAttemptTable
              title="Archived IP attempts"
              rows={archivedAttempts}
              archived
              onDelete={permanentlyDeleteArchivedAttempt}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TrustedIpTable({
  rows,
  onUpdate,
}: {
  rows: TrustedIpAddress[];
  onUpdate: (id: string, patch: { remarks?: string; active?: boolean }) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="mb-3 text-sm font-semibold">Trusted IP addresses</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">IP address</th>
              <th className="px-3 py-2 text-left font-medium">
                <span className="inline-flex items-center gap-1">
                  Remarks
                  <SettingsHelper
                    items={settingsControlHelpers.trustedIpRemarks}
                    label="Trusted IP remarks help"
                  />
                </span>
              </th>
              <th className="px-3 py-2 text-left font-medium">
                <span className="inline-flex items-center gap-1">
                  Status
                  <SettingsHelper
                    items={settingsControlHelpers.trustedIpActive}
                    label="Trusted IP status help"
                  />
                </span>
              </th>
              <th className="px-3 py-2 text-left font-medium">Added by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{row.ipAddress}</td>
                  <td className="px-3 py-2">
                    <input
                      defaultValue={row.remarks}
                      onBlur={(event) => void onUpdate(row.id, { remarks: event.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) => void onUpdate(row.id, { active: event.target.checked })}
                      />
                      {row.active ? "Active" : "Inactive"}
                    </label>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.createdByName || "-"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No trusted IP addresses added.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IpAttemptTable({
  title,
  rows,
  archived,
  onArchive,
  onDelete,
}: {
  title: string;
  rows: IpLoginAttempt[];
  archived: boolean;
  onArchive?: (id: string) => Promise<void>;
  onDelete?: (attempt: IpLoginAttempt) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">IP address</th>
              <th className="px-3 py-2 text-left font-medium">User account</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
              <th className="px-3 py-2 text-left font-medium">Result</th>
              <th className="px-3 py-2 text-left font-medium">Reason</th>
              <th className="px-3 py-2 text-left font-medium">Time</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono">{row.ipAddress}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.userName || row.username}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.userRole ? roleLabel(row.userRole) : "Unknown role"}
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize">{ipModeLabel(row.mode)}</td>
                  <td className="px-3 py-2 capitalize">{row.result}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.reason}</td>
                  <td className="px-3 py-2">{formatDateTime(row.attemptedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {!archived && onArchive ? (
                      <HelpedControl
                        helper={settingsControlHelpers.ipAttemptArchive}
                        label={`${row.ipAddress} attempt archive help`}
                      >
                        <button
                          type="button"
                          onClick={() => void onArchive(row.id)}
                          className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                        >
                          Archive
                        </button>
                      </HelpedControl>
                    ) : archived && onDelete ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {row.archivedByName ? `By ${row.archivedByName}` : "Archived"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void onDelete(row)}
                          className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {row.archivedByName ? `By ${row.archivedByName}` : "Archived"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No IP attempts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ipModeLabel(mode: IpAccessMode) {
  if (mode === "notify") return "Notify";
  if (mode === "restrict") return "Restrict";
  return "Off";
}

function UserSettings() {
  const users = useUsers();
  const divisions = useDivisions();
  const settings = useSettings();
  const fileAccessOptions = useMemo(
    () => getFileCategoryOptions(normalizeFileTypes(settings.fileTypes)),
    [settings.fileTypes],
  );
  const allFileAccessKeys = useMemo(
    () => getAllFileCategoryKeys(normalizeFileTypes(settings.fileTypes)),
    [settings.fileTypes],
  );
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppUserRole>("editor");
  const [cashOutgoEditScope, setCashOutgoEditScope] =
    useState<UniversalViewerCashOutgoEditScope>("none");
  const [emergencyIpBypass, setEmergencyIpBypass] = useState(false);
  const [divisionIds, setDivisionIds] = useState<string[]>([]);
  const [allowedFileCategories, setAllowedFileCategories] =
    useState<FileCategoryKey[]>(allFileAccessKeys);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<AppUserRole>("editor");
  const [editCashOutgoEditScope, setEditCashOutgoEditScope] =
    useState<UniversalViewerCashOutgoEditScope>("none");
  const [editEmergencyIpBypass, setEditEmergencyIpBypass] = useState(false);
  const [editDivisionIds, setEditDivisionIds] = useState<string[]>([]);
  const [editAllowedFileCategories, setEditAllowedFileCategories] = useState<FileCategoryKey[]>([]);

  const add = () => {
    if (!name.trim() || !username.trim() || !password.trim()) return;
    store.addUser({
      name: name.trim(),
      username: username.trim(),
      password: password.trim(),
      role,
      cashOutgoEditScope: role === "universal_viewer" ? cashOutgoEditScope : "none",
      emergencyIpBypass: role === "admin" && emergencyIpBypass,
      divisionIds,
      allowedFileCategories,
    });
    setName("");
    setUsername("");
    setPassword("");
    setRole("editor");
    setCashOutgoEditScope("none");
    setEmergencyIpBypass(false);
    setDivisionIds([]);
    setAllowedFileCategories(allFileAccessKeys);
  };

  const startEdit = (user: (typeof users)[number]) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role);
    setEditCashOutgoEditScope(user.cashOutgoEditScope ?? "none");
    setEditEmergencyIpBypass(Boolean(user.emergencyIpBypass));
    setEditDivisionIds(user.divisionIds ?? []);
    setEditAllowedFileCategories(
      normalizeUserFileCategories(user.allowedFileCategories, fileAccessOptions),
    );
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editUsername.trim()) return;
    store.updateUser(id, {
      name: editName.trim(),
      username: editUsername.trim(),
      ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      role: editRole,
      cashOutgoEditScope: editRole === "universal_viewer" ? editCashOutgoEditScope : "none",
      emergencyIpBypass: editRole === "admin" && editEmergencyIpBypass,
      divisionIds: editDivisionIds,
      allowedFileCategories: editAllowedFileCategories,
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Authorised users</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add users and assign the divisions they should be allowed to work with.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="User name" />
        <DivisionInput value={username} onChange={setUsername} placeholder="Username" />
        <DivisionInput value={password} onChange={setPassword} placeholder="Password" />
        <UserRoleSelect value={role} onChange={setRole} />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-3">
        <EmergencyIpBypassToggle
          role={role}
          checked={emergencyIpBypass}
          onChange={setEmergencyIpBypass}
        />
      </div>
      <div className="mt-3">
        <UniversalViewerCashOutgoScopeSelect
          role={role}
          value={cashOutgoEditScope}
          onChange={setCashOutgoEditScope}
        />
      </div>

      <div className="mt-3">
        <DivisionAccessPicker
          divisions={divisions}
          selectedIds={divisionIds}
          onChange={setDivisionIds}
        />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Allowed file types</div>
        <FileCategoryAccessPicker
          options={fileAccessOptions}
          selectedCategories={allowedFileCategories}
          onChange={setAllowedFileCategories}
        />
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1100px] table-fixed text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[23%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Name</th>
              <th className="text-left font-medium px-4 py-2.5">Username</th>
              <th className="text-left font-medium px-4 py-2.5">Role</th>
              <th className="text-left font-medium px-4 py-2.5">Cash plan/MER</th>
              <th className="text-left font-medium px-4 py-2.5">Visible divisions</th>
              <th className="text-left font-medium px-4 py-2.5">File types</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-muted-foreground text-center" colSpan={7}>
                  No users added yet.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isEditing = editingId === user.id;
                const editChanged =
                  editName.trim() !== user.name ||
                  editUsername.trim() !== user.username ||
                  Boolean(editPassword.trim()) ||
                  editRole !== user.role ||
                  (editRole === "universal_viewer" ? editCashOutgoEditScope : "none") !==
                    (user.cashOutgoEditScope ?? "none") ||
                  (editRole === "admin" && editEmergencyIpBypass) !==
                    Boolean(user.emergencyIpBypass) ||
                  !isSettingsDirtyValueEqual(
                    [...editDivisionIds].sort(),
                    [...(user.divisionIds ?? [])].sort(),
                  ) ||
                  !isSettingsDirtyValueEqual(
                    normalizeUserFileCategories(editAllowedFileCategories, fileAccessOptions),
                    normalizeUserFileCategories(user.allowedFileCategories, fileAccessOptions),
                  );
                return (
                  <tr key={user.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <DivisionInput
                          value={editName}
                          onChange={setEditName}
                          placeholder="User name"
                        />
                      ) : (
                        <span className="font-medium">{user.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <div className="space-y-2">
                          <DivisionInput
                            value={editUsername}
                            onChange={setEditUsername}
                            placeholder="Username"
                          />
                          <DivisionInput
                            value={editPassword}
                            onChange={setEditPassword}
                            placeholder="New password"
                          />
                        </div>
                      ) : (
                        user.username
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <div className="space-y-2">
                          <UserRoleSelect value={editRole} onChange={setEditRole} />
                          <EmergencyIpBypassToggle
                            role={editRole}
                            checked={editEmergencyIpBypass}
                            onChange={setEditEmergencyIpBypass}
                          />
                        </div>
                      ) : (
                        <div>
                          <div>{roleLabel(user.role)}</div>
                          {user.role === "admin" && user.emergencyIpBypass ? (
                            <div className="mt-1 text-xs text-destructive">Emergency IP bypass</div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <UniversalViewerCashOutgoScopeSelect
                          role={editRole}
                          value={editCashOutgoEditScope}
                          onChange={setEditCashOutgoEditScope}
                          compact
                        />
                      ) : (
                        cashOutgoEditScopeLabel(user.role, user.cashOutgoEditScope)
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <DivisionAccessPicker
                          divisions={divisions}
                          selectedIds={editDivisionIds}
                          onChange={setEditDivisionIds}
                        />
                      ) : (
                        divisionAccessLabel(user.divisionIds, divisions)
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <FileCategoryAccessPicker
                          options={fileAccessOptions}
                          selectedCategories={editAllowedFileCategories}
                          onChange={setEditAllowedFileCategories}
                        />
                      ) : (
                        fileCategoryAccessLabel(user.allowedFileCategories, fileAccessOptions)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(user.id)}
                              disabled={!editChanged || !editName.trim() || !editUsername.trim()}
                              className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Check className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(user)}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <HelpedControl
                              helper={settingsControlHelpers.userDelete}
                              label={`Delete ${user.name} help`}
                            >
                              <button
                                type="button"
                                onClick={async () => {
                                  if (await requestDeletionPassword(`delete user "${user.name}"`)) {
                                    store.deleteUser(user.id);
                                  }
                                }}
                                className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </HelpedControl>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRoleSelect({
  value,
  onChange,
}: {
  value: AppUserRole;
  onChange: (value: AppUserRole) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as AppUserRole)}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <option value="admin">Admin</option>
      <option value="sub_admin">Sub admin</option>
      <option value="editor">Editor</option>
      <option value="universal_viewer">Universal Viewer</option>
    </select>
  );
}

function UniversalViewerCashOutgoScopeSelect({
  role,
  value,
  onChange,
  compact = false,
}: {
  role: AppUserRole;
  value: UniversalViewerCashOutgoEditScope;
  onChange: (value: UniversalViewerCashOutgoEditScope) => void;
  compact?: boolean;
}) {
  if (role !== "universal_viewer") {
    return compact ? (
      <span className="text-xs text-muted-foreground">Not applicable</span>
    ) : (
      <div className="text-xs text-muted-foreground">Cash Out Go/MER edit: not applicable</div>
    );
  }
  return (
    <label className={compact ? "block" : "block max-w-md"}>
      <span className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        Universal Viewer Cash Out Go / MER edit
        <SettingsHelper
          items={settingsControlHelpers.universalViewerCashOutgoScope}
          label="Universal Viewer Cash Out Go / MER edit help"
        />
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as UniversalViewerCashOutgoEditScope)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="none">View only</option>
        <option value="personal">Personal Cash Out Go only</option>
        <option value="global">Global Cash Out Go + MER</option>
      </select>
      {!compact ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Personal saves affect only this Universal Viewer. Global saves affect the software and can
          edit MER.
        </p>
      ) : null}
    </label>
  );
}

function ArchiveSettings() {
  const [archivedFiles, setArchivedFiles] = useState<FileRecord[]>([]);
  const [archivedDivisions, setArchivedDivisions] = useState<Division[]>([]);
  const [archivedUsers, setArchivedUsers] = useState<AppUser[]>([]);
  const [archivedFirms, setArchivedFirms] = useState<MasterFirm[]>([]);
  const [archivedIndentors, setArchivedIndentors] = useState<Indentor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadArchive = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const results = await Promise.allSettled([
        store.listArchivedFiles(),
        store.listArchivedDivisions(),
        store.listArchivedUsers(),
        listArchivedMasterFirms(),
        store.listArchivedIndentors(),
      ]);
      const labels = ["Files", "Divisions", "Users", "Master firms", "Indentors"];
      const failures: string[] = [];

      if (results[0].status === "fulfilled") setArchivedFiles(results[0].value.files);
      else failures.push(`${labels[0]}: ${getErrorMessage(results[0].reason)}`);

      if (results[1].status === "fulfilled") setArchivedDivisions(results[1].value.divisions);
      else failures.push(`${labels[1]}: ${getErrorMessage(results[1].reason)}`);

      if (results[2].status === "fulfilled") setArchivedUsers(results[2].value.users);
      else failures.push(`${labels[2]}: ${getErrorMessage(results[2].reason)}`);

      if (results[3].status === "fulfilled") setArchivedFirms(results[3].value.firms);
      else failures.push(`${labels[3]}: ${getErrorMessage(results[3].reason)}`);

      if (results[4].status === "fulfilled") setArchivedIndentors(results[4].value.indentors);
      else failures.push(`${labels[4]}: ${getErrorMessage(results[4].reason)}`);

      if (failures.length) {
        setError(`Some archive bins could not be loaded. ${failures.join("; ")}`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load archive.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchive();
  }, []);

  const restore = async (file: FileRecord) => {
    await store.restoreArchivedFile(file.id);
    await loadArchive();
  };

  const restoreDivision = async (division: Division) => {
    await store.restoreArchivedDivision(division.id);
    await loadArchive();
  };

  const restoreUser = async (user: AppUser) => {
    await store.restoreArchivedUser(user.id);
    await loadArchive();
  };

  const restoreFirm = async (firm: MasterFirm) => {
    await restoreArchivedMasterFirm(firm.id);
    await loadArchive();
  };

  const restoreIndentor = async (indentor: Indentor) => {
    await store.restoreArchivedIndentor(indentor.id);
    await loadArchive();
  };

  const permanentlyDeleteDivision = async (division: Division) => {
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived division "${division.name}"`,
    );
    if (deletionPassword === null) return;
    try {
      await store.permanentlyDeleteArchivedDivision(division.id, deletionPassword);
      await loadArchive();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete archived division.");
    }
  };

  const permanentlyDelete = async (file: FileRecord) => {
    const label = file.uniqueCode || file.fileNo || file.indentor || file.id;
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived file "${label}"`,
    );
    if (deletionPassword === null) return;
    await store.permanentlyDeleteArchivedFile(file.id, deletionPassword);
    await loadArchive();
  };

  const permanentlyDeleteUser = async (user: AppUser) => {
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived user "${user.name}"`,
    );
    if (deletionPassword === null) return;
    await store.permanentlyDeleteArchivedUser(user.id, deletionPassword);
    await loadArchive();
  };

  const permanentlyDeleteFirm = async (firm: MasterFirm) => {
    const label = firm.firmName || firm.emailId || firm.firmUniqueNo || firm.id;
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived firm "${label}"`,
    );
    if (deletionPassword === null) return;
    await permanentlyDeleteArchivedMasterFirm(firm.id, deletionPassword);
    await loadArchive();
  };

  const permanentlyDeleteIndentor = async (indentor: Indentor) => {
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived indentor "${indentor.name}"`,
    );
    if (deletionPassword === null) return;
    await store.permanentlyDeleteArchivedIndentor(indentor.id, deletionPassword);
    await loadArchive();
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Archive</h2>
          <p className="text-xs text-muted-foreground">
            Review archived files, divisions, users, firms, and indentors.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadArchive()}
          className="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <details open className="mb-5 overflow-hidden rounded-md border border-border">
        <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
          Divisions bin ({archivedDivisions.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Archived division</th>
                <th className="px-4 py-2.5 text-left font-medium">Code</th>
                <th className="px-4 py-2.5 text-left font-medium">AD</th>
                <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
                <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Loading archived divisions...
                  </td>
                </tr>
              ) : archivedDivisions.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No archived divisions.
                  </td>
                </tr>
              ) : (
                archivedDivisions.map((division) => (
                  <tr key={division.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{division.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {division.code || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{division.ad || "No"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {division.archivedAt ? formatArchiveDate(division.archivedAt) : "Not set"}
                    </td>
                    <td className="py-3 pl-8 pr-4">
                      <div className="flex justify-end gap-1">
                        <HelpedControl
                          helper={settingsControlHelpers.archiveRestore}
                          label="Restore archived division help"
                        >
                          <button
                            type="button"
                            onClick={() => void restoreDivision(division)}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                          >
                            Restore
                          </button>
                        </HelpedControl>
                        <HelpedControl
                          helper={settingsControlHelpers.archiveDelete}
                          label="Delete archived division help"
                        >
                          <button
                            type="button"
                            onClick={() => void permanentlyDeleteDivision(division)}
                            className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </HelpedControl>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details open className="mb-5 overflow-hidden rounded-md border border-border">
        <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
          Files bin ({archivedFiles.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-sm">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Unique code</th>
                <th className="px-4 py-2.5 text-left font-medium">Division</th>
                <th className="px-4 py-2.5 text-left font-medium">Indentor</th>
                <th className="px-4 py-2.5 text-left font-medium">Description</th>
                <th className="px-4 py-2.5 text-left font-medium">Year</th>
                <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading archive...
                  </td>
                </tr>
              ) : archivedFiles.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No archived files.
                  </td>
                </tr>
              ) : (
                archivedFiles.map((file) => (
                  <tr key={file.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{file.uniqueCode || "Not set"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {file.division || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {file.indentor || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {getArchivedFileDescription(file)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{file.year || "Not set"}</td>
                    <td className="py-3 pl-8 pr-4">
                      <div className="flex justify-end gap-1">
                        <HelpedControl
                          helper={settingsControlHelpers.archiveRestore}
                          label="Restore archived file help"
                        >
                          <button
                            type="button"
                            onClick={() => void restore(file)}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                          >
                            Restore
                          </button>
                        </HelpedControl>
                        <HelpedControl
                          helper={settingsControlHelpers.archiveDelete}
                          label="Delete archived file help"
                        >
                          <button
                            type="button"
                            onClick={() => void permanentlyDelete(file)}
                            className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </HelpedControl>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details className="mb-5 overflow-hidden rounded-md border border-border">
        <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
          Users bin ({archivedUsers.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed text-sm">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">User</th>
                <th className="px-4 py-2.5 text-left font-medium">Username</th>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
                <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Loading archived users...
                  </td>
                </tr>
              ) : archivedUsers.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No archived users.
                  </td>
                </tr>
              ) : (
                archivedUsers.map((user) => (
                  <tr key={user.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{user.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.username}</td>
                    <td className="px-4 py-3 text-muted-foreground">{roleLabel(user.role)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {user.archivedAt ? formatArchiveDate(user.archivedAt) : "Not set"}
                    </td>
                    <td className="py-3 pl-8 pr-4">
                      <div className="flex justify-end gap-1">
                        <HelpedControl
                          helper={settingsControlHelpers.archiveRestore}
                          label="Restore archived user help"
                        >
                          <button
                            type="button"
                            onClick={() => void restoreUser(user)}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                          >
                            Restore
                          </button>
                        </HelpedControl>
                        <HelpedControl
                          helper={settingsControlHelpers.archiveDelete}
                          label="Delete archived user help"
                        >
                          <button
                            type="button"
                            onClick={() => void permanentlyDeleteUser(user)}
                            className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </HelpedControl>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details className="mb-5 overflow-hidden rounded-md border border-border">
        <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
          Master firms bin ({archivedFirms.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Firm</th>
                <th className="px-4 py-2.5 text-left font-medium">Unique No.</th>
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Contact</th>
                <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
                <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading archived firms...
                  </td>
                </tr>
              ) : archivedFirms.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No archived firms.
                  </td>
                </tr>
              ) : (
                archivedFirms.map((firm) => (
                  <tr key={firm.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{firm.firmName || "Not set"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {firm.firmUniqueNo || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{firm.emailId || "Not set"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {firm.contactNo || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {firm.archivedAt ? formatArchiveDate(firm.archivedAt) : "Not set"}
                    </td>
                    <td className="py-3 pl-8 pr-4">
                      <div className="flex justify-end gap-1">
                        <HelpedControl
                          helper={settingsControlHelpers.archiveRestore}
                          label="Restore archived firm help"
                        >
                          <button
                            type="button"
                            onClick={() => void restoreFirm(firm)}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                          >
                            Restore
                          </button>
                        </HelpedControl>
                        <HelpedControl
                          helper={settingsControlHelpers.archiveDelete}
                          label="Delete archived firm help"
                        >
                          <button
                            type="button"
                            onClick={() => void permanentlyDeleteFirm(firm)}
                            className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </HelpedControl>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details className="overflow-hidden rounded-md border border-border">
        <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
          Indentors bin ({archivedIndentors.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed text-sm">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[20%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="bg-secondary text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Indentor</th>
                <th className="px-4 py-2.5 text-left font-medium">Division</th>
                <th className="px-4 py-2.5 text-left font-medium">SF ID</th>
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
                <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading archived indentors...
                  </td>
                </tr>
              ) : archivedIndentors.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No archived indentors.
                  </td>
                </tr>
              ) : (
                archivedIndentors.map((indentor) => (
                  <tr key={indentor.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-medium">{indentor.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{indentor.divisionName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{indentor.sfId}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {indentor.email || "Not set"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {indentor.archivedAt ? formatArchiveDate(indentor.archivedAt) : "Not set"}
                    </td>
                    <td className="py-3 pl-8 pr-4">
                      <div className="flex justify-end gap-1">
                        <HelpedControl
                          helper={settingsControlHelpers.archiveRestore}
                          label="Restore archived indentor help"
                        >
                          <button
                            type="button"
                            onClick={() => void restoreIndentor(indentor)}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                          >
                            Restore
                          </button>
                        </HelpedControl>
                        <HelpedControl
                          helper={settingsControlHelpers.archiveDelete}
                          label="Delete archived indentor help"
                        >
                          <button
                            type="button"
                            onClick={() => void permanentlyDeleteIndentor(indentor)}
                            className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </HelpedControl>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function formatArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getArchivedFileDescription(file: FileRecord) {
  const uniqueCode = (file.uniqueCode ?? "").trim();
  const description = (file.demandDescription ?? "").trim();
  if (uniqueCode && description) return `${uniqueCode} — ${description}`;
  return description || uniqueCode || "Not set";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function DivisionAccessPicker({
  divisions,
  selectedIds,
  onChange,
}: {
  divisions: ReturnType<typeof useDivisions>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (divisionId: string) => {
    onChange(
      selectedIds.includes(divisionId)
        ? selectedIds.filter((id) => id !== divisionId)
        : [...selectedIds, divisionId],
    );
  };

  if (divisions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
        Add divisions first.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {divisions.map((division) => (
        <label
          key={division.id}
          className="inline-flex items-center gap-2 min-h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(division.id)}
            onChange={() => toggle(division.id)}
            className="size-4 rounded border-input"
          />
          <span>{division.name}</span>
        </label>
      ))}
    </div>
  );
}

function FileCategoryAccessPicker({
  options,
  selectedCategories,
  onChange,
}: {
  options: FileCategoryOption[];
  selectedCategories: FileCategoryKey[];
  onChange: (categories: FileCategoryKey[]) => void;
}) {
  const toggle = (category: FileCategoryKey) => {
    onChange(
      selectedCategories.includes(category)
        ? selectedCategories.filter((item) => item !== category)
        : options
            .map((option) => option.key)
            .filter((key) => selectedCategories.includes(key) || key === category),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.key}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedCategories.includes(option.key)}
              onChange={() => toggle(option.key)}
              className="size-4 rounded border-input"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">Checked file types are accessible.</div>
    </div>
  );
}

function EmergencyIpBypassToggle({
  role,
  checked,
  onChange,
}: {
  role: AppUserRole;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const disabled = role !== "admin";
  return (
    <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
      <input
        type="checkbox"
        checked={!disabled && checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="size-4 rounded border-input"
      />
      <span>Emergency IP bypass</span>
      <SettingsHelper
        items={[
          "Only Admin accounts can use this bypass.",
          "When Restrict mode is enabled, this Admin can still log in from an untrusted IP.",
          "The login is still recorded in New IP history and shown to Admin.",
        ]}
        label="Emergency IP bypass help"
      />
    </label>
  );
}

function roleLabel(role: AppUserRole) {
  if (role === "admin") return "Admin";
  if (role === "sub_admin") return "Sub admin";
  if (role === "editor") return "Editor";
  if (role === "universal_viewer") return "Universal Viewer";
  if (role === "division_user") return "Division user";
  return "Viewer";
}

function cashOutgoEditScopeLabel(role: AppUserRole, scope?: string | null) {
  if (role !== "universal_viewer") return "Not applicable";
  if (scope === "personal") return "Personal Cash Out Go";
  if (scope === "global") return "Global Cash Out Go + MER";
  return "View only";
}

function normalizeUserFileCategories(
  values: string[] | null | undefined,
  options: FileCategoryOption[] = fileCategoryOptions,
): FileCategoryKey[] {
  const optionKeys = options.map((option) => option.key);
  if (!values) return optionKeys;
  const allowedKeys = new Set(optionKeys);
  const expandedValues = new Set(values);
  if (
    expandedValues.has("goodsServices") &&
    expandedValues.has("amc") &&
    expandedValues.has("mpc") &&
    expandedValues.has("cars") &&
    !expandedValues.has("om")
  ) {
    expandedValues.add("om");
  }
  return options
    .map((option) => option.key)
    .filter((key) => expandedValues.has(key) && allowedKeys.has(key));
}

function fileCategoryAccessLabel(
  values: string[] | null | undefined,
  options: FileCategoryOption[] = fileCategoryOptions,
) {
  const categories = normalizeUserFileCategories(values, options);
  if (categories.length === options.length) return "All file types";
  if (categories.length === 0) return "No file types";
  return categories
    .map((key) => options.find((option) => option.key === key)?.label)
    .filter(Boolean)
    .join(", ");
}

function divisionAccessLabel(selectedIds: string[], divisions: ReturnType<typeof useDivisions>) {
  if (selectedIds.length === 0) return "No divisions selected";
  const names = selectedIds
    .map((id) => divisions.find((division) => division.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(", ") : "No matching divisions";
}

function EditableField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. 2026"
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  disabled = false,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  helper?: string[];
}) {
  return (
    <label className="block">
      <div className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium">
        {label}
        {helper?.length ? <SettingsHelper items={helper} label={`${label} help`} /> : null}
      </div>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Required for delete actions"
        disabled={disabled}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
      />
    </label>
  );
}

function DivisionInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function IndentorDivisionSelect({
  value,
  divisions,
  disabled = false,
  onChange,
}: {
  value: string;
  divisions: Division[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <option value="">Select division</option>
      {divisions.map((division) => (
        <option key={division.id} value={division.id}>
          {division.name}
        </option>
      ))}
    </select>
  );
}

function IndentorDesignationField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const isPreset = indentorDesignationOptions.includes(value);
  const [otherMode, setOtherMode] = useState(Boolean(value && !isPreset));
  const selected = otherMode ? "Other" : value;

  useEffect(() => {
    if (value && !indentorDesignationOptions.includes(value)) {
      setOtherMode(true);
    }
    if (indentorDesignationOptions.includes(value)) {
      setOtherMode(false);
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <select
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          setOtherMode(next === "Other");
          onChange(next === "Other" ? "" : next);
        }}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">Designation</option>
        {indentorDesignationOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="Other">Other</option>
      </select>
      {selected === "Other" ? (
        <DivisionInput value={value} onChange={onChange} placeholder="Type designation" />
      ) : null}
    </div>
  );
}

function IndentorCell({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className="px-4 py-3 text-muted-foreground">
      {editing ? <DivisionInput value={value} onChange={onChange} placeholder="" /> : value}
    </td>
  );
}

function IndentorDesignationCell({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className="px-4 py-3 text-muted-foreground">
      {editing ? <IndentorDesignationField value={value} onChange={onChange} /> : value}
    </td>
  );
}

function DivisionAdSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="AD"
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <option value="">AD</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

function ThemeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "light" | "dark";
  onChange: (value: "light" | "dark") => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as "light" | "dark")}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="light">White theme</option>
        <option value="dark">Dark theme</option>
      </select>
    </label>
  );
}

function ThemeTintField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
  onChange: (value: "plain" | "yellow" | "green" | "blue" | "pink" | "lavender") => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value as "plain" | "yellow" | "green" | "blue" | "pink" | "lavender",
          )
        }
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="plain">Plain white / black</option>
        <option value="yellow">Yellow tinted</option>
        <option value="green">Green tinted</option>
        <option value="blue">Blue tinted</option>
        <option value="pink">Pink tinted</option>
        <option value="lavender">Lavender tinted</option>
      </select>
    </label>
  );
}

function RibbonFieldSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AddEditRibbonFieldKey;
  onChange: (value: AddEditRibbonFieldKey) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AddEditRibbonFieldKey)}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        {addEditRibbonFieldOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <input
        defaultValue={value}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function isSettingsDirtyValueEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
