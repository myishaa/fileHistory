import { createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  DatabaseBackup,
  Download,
  Info,
  Lock,
  Pencil,
  Plus,
  Search,
  Save,
  Upload,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { CompactTableText } from "@/components/compact-table-text";
import { showAppAlert, showAppConfirm, showAppPrompt } from "@/components/app-dialog";
import { DeleteConfirmation } from "@/components/delete-confirmation";
import { PasswordInput } from "@/components/password-input";
import { ClearableInput } from "@/components/clearable-input";
import { QuickAccessSettings } from "@/components/quick-access";
import { QuickEntryExcelSettings } from "@/components/quick-entry-excel";
import { chartColorOptions } from "@/lib/chart-colors";
import {
  hasUnsavedChanges as hasAnyUnsavedChanges,
  useUnsavedChanges,
} from "@/lib/unsaved-changes";
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
  useFiles,
  useSettings as useStoreSettings,
  useUsers,
  type AppSettings,
  type AppFontFamily,
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
  type AppearancePreset,
  type TopRibbonColor,
  type TopRibbonTextColor,
  type TrustedIpAddress,
  type UniversalViewerCashOutgoEditScope,
  type ValueThresholdAppliesTo,
  type ValueThresholdLevel,
} from "@/lib/files-store";
import { getMmgSummaryFieldOptions, normalizeMmgSummaryFields } from "@/lib/mmg-summary";
import {
  getDemandProcessingField,
  getDemandProcessingFieldGroups,
  type DemandProcessingPreset,
} from "@/lib/demand-processing-analysis";
import { tableFieldPresetGroups, type TableFieldPreset } from "@/lib/table-field-presets";
import {
  promptDeletionPassword,
  promptPassword,
  requestDeletionPassword,
} from "@/lib/delete-password";
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
import { HelperContent } from "@/components/helper-content";
import { HelperPdfButton } from "@/components/helper-content";
import { SearchableDropdown } from "@/components/searchable-dropdown";
import {
  ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
  displayFinancialYearLabel,
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isAllFilesYear,
  normalizeMilestoneName,
} from "@/lib/year-filter";
import {
  createFirmRatingFieldId,
  defaultFirmRatingFields,
  normalizeFirmRatingConfig,
} from "@/lib/firm-rating";
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
import {
  SettingsDraftContext,
  type SettingsDraftActions,
  type SettingsExternalDraftHandlers,
} from "@/lib/settings-draft";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function useSettings() {
  const draft = useContext(SettingsDraftContext);
  const savedSettings = useStoreSettings();
  return draft?.settings ?? savedSettings;
}

function useSettingsUpdater() {
  const draft = useContext(SettingsDraftContext);
  return draft?.updateSettings ?? store.updateSettings;
}

function SettingsDraftActionBar({ actions }: { actions: SettingsDraftActions }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {actions.saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {actions.saveError}
        </p>
      ) : (
        <span />
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={actions.cancelChanges}
          disabled={actions.saving || !actions.hasUnsavedChanges}
          className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void actions.saveChanges()}
          disabled={!actions.hasChanges || actions.saving}
          className="h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Save className="size-4" /> {actions.saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function SettingsDraftActionBarFromContext() {
  const draft = useContext(SettingsDraftContext);
  return draft?.actions ? <SettingsDraftActionBar actions={draft.actions} /> : null;
}

function UserSettingsDraft({
  children,
  scope = "personal",
  editors = "You",
  showScope = true,
  actionPlacement = "top",
}: {
  children: ReactNode;
  scope?: SettingsScopeKind;
  editors?: string;
  showScope?: boolean;
  actionPlacement?: "top" | "inside";
}) {
  const savedSettings = useStoreSettings();
  const [draftPatch, setDraftPatch] = useState<Partial<AppSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const hasChanges = Object.keys(draftPatch).length > 0;
  const [localDirty, setLocalDirty] = useState(false);
  const unsavedChangesSourceId = useId();
  useUnsavedChanges(`settings-draft:${unsavedChangesSourceId}`, hasChanges || localDirty);
  const externalDraftRef = useRef<SettingsExternalDraftHandlers | null>(null);
  const updateSettings = (patch: Partial<AppSettings>) => {
    setDraftPatch((current) => ({ ...current, ...patch }));
    setSaveError("");
  };
  const cancelChanges = async () => {
    if (
      (hasChanges || localDirty) &&
      !(await showAppConfirm("Discard your unsaved settings changes?"))
    )
      return;
    setDraftPatch({});
    externalDraftRef.current?.cancel();
    setLocalDirty(false);
    setSaveError("");
  };
  const saveChanges = async () => {
    if (!hasChanges || saving) return;
    if (localDirty) {
      setSaveError("Finish or cancel the section's local edit before saving these settings.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await store.saveSettings(draftPatch);
      setDraftPatch({});
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const actions: SettingsDraftActions = {
    hasChanges,
    hasUnsavedChanges: hasChanges || localDirty,
    saving,
    saveError,
    cancelChanges,
    saveChanges,
  };
  return (
    <div className="space-y-3">
      {showScope ? <SettingsScope scope={scope} editors={editors} /> : null}
      {actionPlacement === "top" ? <SettingsDraftActionBar actions={actions} /> : null}
      <SettingsDraftContext.Provider
        value={{
          settings: { ...savedSettings, ...draftPatch },
          updateSettings,
          actions,
          setLocalDirty,
          registerExternalDraft: (handlers) => {
            externalDraftRef.current = handlers;
          },
        }}
      >
        <fieldset disabled={saving}>{children}</fieldset>
      </SettingsDraftContext.Provider>
    </div>
  );
}

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
type MasterValueStatus = "active" | "inactive";
type MasterValueUsageRow = {
  value: string;
  usageCount: number;
  status: MasterValueStatus;
};

function appendFileClosedMilestone(milestones: string[]) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const normalizedMilestones = milestones.map(normalizeConfiguredMilestoneLabel);
  const withoutFileClosed = normalizedMilestones.filter(
    (milestone) => normalize(milestone) !== normalize(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
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
  searchText?: string;
};

const adminSectionSearchText: Record<string, string> = {
  theme: "appearance UI theme colour color font family font size top ribbon",
  noticeBoard: "notice board message display rotation duration personal shared",
  quickEntryExcel: "quick entry Excel export columns configure download",
  user: "account role division display preferences profile",
  workspace: "workspace current financial year FY archive restore lock selection",
  offsetDays: "offset days S.O. payment BG return date delay status threshold estimated date",
  yearSetup: "year setup financial year division budgets add merge split",
  mmgSummary: "MMG summary fields labels PDF Excel export rows",
  demandProcessing:
    "demand processing analysis presets date pair ranges from date to date TCEC",
  divisions: "division name code budget active archive delete",
  indentors: "indentor contact details division assignment",
  firms: "firm database firm name unique number firm type add edit archive delete",
  firmRating: "firm rating criteria items maximum marks score",
  fileTypes: "file types goods services contract group active inactive rename",
  modes: "modes procurement mode active inactive rename",
  gemBiddingModes: "GeM bidding modes custom catalogue comparison add inactive",
  firmTypes: "firm types MSE Non-MSE add inactive rename",
  fileMarkers: "file markers marker code tag active inactive",
  tcec: "TCEC committee committee names",
  thresholds: "value thresholds capital revenue both financial year bands",
  bgReceiptDelay: "BG receipt delay guarantee received S.O. date threshold",
  anomalyGovernance: "anomaly control suspected data issues accept reject reopen",
  milestones:
    "milestones workflow sequence add activate reorder inactivate remove file closed current completed",
  presets: "preset table fields Search export columns manual shared personal",
  users: "authorised users accounts roles permissions access",
  ipAccess: "IP access trusted IP address notify restrict login attempts",
  archive: "archive archived records files restore permanent delete",
  protectedBackup:
    "protected backup encrypted database restore upload password recovery PIN scheduled destination",
};

// Keep the Settings search index aligned with the visible controls in each
// section. Search results intentionally open a section rather than a single
// control, matching the existing left-panel navigation model.
const adminSectionControlLabels: Record<string, string[]> = {
  theme: [
    "Appearance preset",
    "Font family",
    "Font size",
    "Theme tint",
    "Top ribbon color",
    "Chart colors",
  ],
  noticeBoard: [
    "Notice board messages",
    "Notice board rotation",
    "Slide duration",
    "Fade in duration",
    "Fade out duration",
    "Vertical scroll duration",
  ],
  quickEntryExcel: ["Quick Entry Excel columns", "Excel export fields", "Column order"],
  user: ["User name", "Username", "Role", "Division access", "Personal deletion password"],
  workspace: [
    "Financial years",
    "FY",
    "New financial year",
    "Create FY now",
    "Set as Current FY",
    "Current FY",
    "Year selection lock",
    "Lock year selection",
    "Locked",
    "Unlocked",
    "Archive FY now",
    "Restore FY now",
    "Delete FY now",
    "Include active files from archived years",
  ],
  offsetDays: [
    "Bill payment offset days",
    "Hand submission offset days",
    "Delivery Period offset days",
    "D.P. offset days",
    "Delay Status default threshold",
    "BG return offset days",
  ],
  yearSetup: ["Financial year", "Division budgets", "Capital budget", "Revenue budget"],
  mmgSummary: ["MMG Summary fields", "Display fields", "Field labels", "PDF export", "Excel export"],
  demandProcessing: [
    "Preset name",
    "From date",
    "To date",
    "Date pair",
    "Demand processing day ranges",
    "Add range",
    "Save ranges",
  ],
  divisions: ["Division name", "Division code", "Capital budget", "Revenue budget"],
  indentors: ["Indentor name", "Name", "SF ID", "Designation", "Mobile number", "Email id"],
  firms: [
    "Firm name",
    "Firm Unique No.",
    "Firm Unique Number",
    "Email id",
    "Address",
    "City",
    "Contact No.",
    "Firm type",
  ],
  firmRating: ["Rating criteria", "Criteria label", "Weight", "Minimum marks", "Maximum marks"],
  fileTypes: ["File type", "Workflow group", "Goods and Services", "Contract", "Active", "Inactive"],
  modes: ["Mode name", "Procurement mode", "Active", "Inactive"],
  gemBiddingModes: ["GeM bidding mode", "Add GeM bidding mode", "Active", "Inactive"],
  firmTypes: ["Firm type", "Add firm type", "Active", "Inactive"],
  fileMarkers: ["Marker code", "Explanation", "When to use", "Active", "Inactive"],
  tcec: ["Committee name", "TCEC committee", "Add committee"],
  thresholds: ["Minimum value", "Maximum value", "Capital", "Revenue", "Both", "Value band"],
  bgReceiptDelay: ["BG receipt delay days", "Threshold days", "Guarantee receipt threshold"],
  anomalyGovernance: ["Anomaly status", "Accept anomaly", "Reject anomaly", "Reopen anomaly"],
  milestones: ["Milestone name", "Add milestone", "Activate milestone", "Inactivate milestone", "Move milestone"],
  presets: ["Preset name", "Table fields", "Manual fields", "Shared preset", "Personal preset"],
  users: ["Authorised users", "Username", "User name", "Role", "Division access", "File type access"],
  ipAccess: ["IP access mode", "Trusted IP address", "IP address", "Login attempts", "Remarks"],
  archive: ["Archived files", "Archived records", "Restore file", "Permanently delete"],
  protectedBackup: [
    "Create database backup",
    "Restore database backup",
    "Upload password",
    "Recovery PIN",
    "Scheduled backup",
    "Destination directory",
    "Retention",
  ],
};

type SettingsScopeKind = "personal" | "shared";

function SettingsScope({ scope, editors }: { scope: SettingsScopeKind; editors: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-4">
      <span className="font-semibold text-foreground">
        {scope === "personal" ? "Only for your account" : "Shared with all users"}
      </span>
      <span className="text-muted-foreground">Can be edited by: {editors}</span>
    </div>
  );
}

function adminSettingsScope(key: string, role: AppUserRole | undefined) {
  if (key === "theme" || key === "user") return { scope: "personal" as const, editors: "You" };
  if (key === "presets" && role !== "admin") {
    return { scope: "personal" as const, editors: "You" };
  }
  if (key === "mmgSummary") {
    return { scope: "shared" as const, editors: "Administrators" };
  }
  if (key === "indentors") {
    return { scope: "shared" as const, editors: "Administrators and Sub-admins" };
  }
  if (key === "firms") {
    return { scope: "shared" as const, editors: "Administrators, Sub-admins, and Editors" };
  }
  return { scope: "shared" as const, editors: "Administrators" };
}

const adminSectionKeys = new Set([
  "theme",
  "user",
  "workspace",
  "offsetDays",
  "yearSetup",
  "mmgSummary",
  "demandProcessing",
  "divisions",
  "indentors",
  "firms",
  "firmRating",
  "fileTypes",
  "modes",
  "gemBiddingModes",
  "firmTypes",
  "fileMarkers",
  "tcec",
  "thresholds",
  "bgReceiptDelay",
  "anomalyGovernance",
  "milestones",
  "presets",
  "users",
  "ipAccess",
  "archive",
  "protectedBackup",
  "noticeBoard",
  "quickEntryExcel",
]);

type SettingsAccent = "sky" | "amber" | "violet" | "teal" | "emerald";

const settingsAccentByGroup: Record<string, SettingsAccent> = {
  organization: "sky",
  procurement: "amber",
  analytics: "violet",
  access: "teal",
  personal: "emerald",
};

const settingsAccentBySection: Record<string, SettingsAccent> = {
  workspace: "sky",
  yearSetup: "sky",
  divisions: "sky",
  indentors: "sky",
  modes: "amber",
  gemBiddingModes: "amber",
  fileTypes: "amber",
  firmTypes: "amber",
  firms: "amber",
  tcec: "amber",
  fileMarkers: "amber",
  milestones: "amber",
  thresholds: "violet",
  bgReceiptDelay: "violet",
  offsetDays: "violet",
  demandProcessing: "violet",
  presets: "violet",
  firmRating: "violet",
  mmgSummary: "violet",
  anomalyGovernance: "violet",
  quickEntryExcel: "violet",
  user: "teal",
  users: "teal",
  ipAccess: "teal",
  archive: "teal",
  protectedBackup: "teal",
  theme: "emerald",
  noticeBoard: "emerald",
};

const settingsGroupHeaderAccentClasses: Record<SettingsAccent, string> = {
  sky: "bg-primary/15 text-foreground shadow-sm",
  amber: "bg-primary/15 text-foreground shadow-sm",
  violet: "bg-primary/15 text-foreground shadow-sm",
  teal: "bg-primary/15 text-foreground shadow-sm",
  emerald: "bg-primary/15 text-foreground shadow-sm",
};

const settingsGroupAccentClasses: Record<SettingsAccent, string> = {
  sky: "border-primary/20 bg-primary/5",
  amber: "border-primary/20 bg-primary/5",
  violet: "border-primary/20 bg-primary/5",
  teal: "border-primary/20 bg-primary/5",
  emerald: "border-primary/20 bg-primary/5",
};

const settingsPanelAccentClasses: Record<SettingsAccent, string> = {
  sky: "bg-primary/5",
  amber: "bg-primary/5",
  violet: "bg-primary/5",
  teal: "bg-primary/5",
  emerald: "bg-primary/5",
};

function settingsAccentForSection(key: string) {
  return settingsAccentBySection[key] ?? "sky";
}

const milestoneHelperSectionOrder = [
  "What it does",
  "Examples",
  "Filter",
  "What is counted",
  "Included and Excluded",
  "Additional details",
  "Add or activate",
  "Reorder",
  "Remove",
  "Clicking a result",
  "Caution",
];

const settingsSectionHelpers = {
  noticeBoard: [
    "Administrator displays and rotation duration are saved centrally and appear for other accounts after refresh or sign-in. Personal displays stay on this browser.",
  ],
  quickEntryExcel: [
    "Administrators configure Excel exports here. Saved exports are shared with all users on the Quick Entry page.",
  ],
  protectedBackup: [
    "Creates an encrypted database backup (.rbk) for emergency recovery.",
    "Only Administrators can create or restore protected backups; backup files cannot be deleted from this application.",
    "Restoring requires both the database backup's encryption password and the separately configured Upload password.",
    "Upload Settings has separate workflows: first-time setup, change Upload password, change Recovery PIN, and forgotten-password recovery.",
    "To change the Upload password or Recovery PIN, complete Step 1 by verifying the current Upload password. Changing the Upload password does not change the Recovery PIN.",
    "If the Upload password is forgotten, use Step 2C with the separately configured six-digit Recovery PIN. If both are forgotten, a server/database administrator must recover the account.",
    "The full recovery package also captures PostgreSQL database data, PostgreSQL roles/globals, configured external storage, and explicitly configured deployment files.",
    "Deployment secrets are included only when the server administrator explicitly configures RECORDKEEPER_BACKUP_SECRETS_FILE; otherwise transfer them through the organisation's secure secret-management process.",
    "Scheduled server backups run only when the On switch is enabled and the server-side encryption password and destination directory are configured.",
  ],
  theme: [
    "Sets the appearance for this account.",
    "Appearance only; file data and workflow rules stay unchanged.",
  ],
  user: [
    "Account details include the assigned role and accessible divisions.",
    "Display preferences are saved per account.",
  ],
  workspace: [
    "Purpose: Sets the current financial year used for new files and current-year views for everyone.",
    "Example table: Setting before | Setting after | Effect on records",
    "Example row: Current FY 2025-26 | Current FY 2026-27 | New files use 2026-27; existing files keep their recorded FY.",
  ],
  offsetDays: [
    "Set shared day offsets for expected S.O., payment, and BG-return dates, plus the default Delay Status threshold.",
    "Each offset identifies its starting event and estimated date. Delay Status uses its setting as the default; individual report views may temporarily use another threshold.",
    "Resetting a local override restores the latest value set here.",
    "Example table: Trigger date | Offset | Estimated date | Interpretation",
    "Example row: Bill sent: 10 Oct | 20 days | 30 Oct | Expected payment date is estimated from the submission date plus the configured offset; it is not a recorded payment date.",
  ],
  yearSetup: [
    "Purpose: Selects the FY whose division budgets you are editing.",
    "Global Filter separately controls which files are shown.",
    "Example table: Budget FY | Global Filter FY | Result",
    "Example row: 2026-27 | 2025-26 files | Budget remains attached to 2026-27; the Global Filter does not move it.",
  ],
  mmgSummary: [
    "Purpose: Chooses which MMG Summary rows and labels appear on screen and in PDF/Excel exports.",
    "Example table: Change | Report and export result | Data result",
    "Example row: Rename Total demands to Demand count | Both show Demand count | The calculated value stays the same.",
    "Example row: Uncheck a field | Its row is hidden | File data and calculation stay unchanged.",
  ],
  demandProcessing: [
    "Presets choose which demand-processing dates are compared.",
    "Day ranges group the gaps shown in Reports > Demand processing analysis.",
    "These choices change how results are grouped, not the dates saved on files.",
    "Example table: From date | To date | Gap | Interpretation",
    "Example row: Bill resubmitted: 15 May | Paid: 20 May | 5 days | The selected date pair measures the final resubmission-to-payment interval for this returned bill.",
  ],
  divisions: [
    "Purpose: Manages division names, codes, and budgets.",
    "Example table: Change | New entries | Existing files",
    "Example row: Correct ACC Divison to ACC Division | Corrected name is offered | Recorded division does not move to another division.",
    "A division used by an active or archived file cannot be deleted.",
  ],
  indentors: [
    "Purpose: Manages indentor contact details and division assignments.",
    "Example table: Directory change | New files | Existing files",
    "Example row: Rina Sharma to Reena Sharma | Use Reena Sharma | Keep the saved Rina Sharma name.",
    "An indentor used by an active or archived file cannot be deleted.",
  ],
  firms: [
    "Purpose: Maintains firm names, Firm Unique No., and firm types for new S.O. entries.",
    "Example table: Directory change | New S.O. | Existing S.O.s",
    "Example row: Type Other; detail Cooperative | Copies Other / Cooperative | Keeps the type saved earlier.",
    "Example row: North Star Ltd to North Star Limited | Uses the corrected name | Keeps North Star Ltd where already saved.",
    "Admin or sub-admin can add a firm type beside the selector; it becomes available here and in S.O. details.",
    "Change a name only to correct the same firm's directory entry.",
    "A firm used by an active or archived file/S.O. cannot be deleted.",
  ],
  firmRating: [
    "Choose the rating items and maximum marks used for firms.",
    "These choices affect scores in Firm Performance.",
  ],
  fileTypes: [
    "Purpose: Chooses whether a file type follows Goods & Services or Contract workflow rules.",
    "Example table: Type | Chosen group | Result",
    "Example row: New AMC type | Contract | New files of that type follow the Contract workflow.",
    "Example row: Type already used by a file | Change Goods & Services to Contract | Blocked; inactivate the old type and add a replacement.",
    "Once a file uses a type, its name and group are locked. Inactivate it to keep it off new files.",
  ],
  modes: [
    "Purpose: Manages procurement modes used in file entry, filters, and reports.",
    "Example table: Change | New files | Existing files",
    "Example row: Replace an old mode | Select the new mode; inactivate the old one | Keep the originally recorded mode.",
    "A mode already used on a file cannot be renamed. Inactivate it to stop offering it for new files.",
  ],
  gemBiddingModes: [
    "GeM bidding modes appear in Add/Edit, Search filters, and Dashboard counts.",
    "Custom, Catalogue, and Comparison are always available. Add new choices here for future entries; existing file values are not changed.",
  ],
  firmTypes: [
    "Firm types such as MSE and Non-MSE are used in S.O. details and firm-type reports.",
    "Example table: Change | New S.O.s | Existing S.O.s",
    "Example row: Add a replacement category; inactivate old one | Replacement is offered | Keep the saved old type.",
    "A type already used on an S.O. cannot be renamed. Inactivate it to stop offering it for new entries.",
  ],
  fileMarkers: [
    "Marker codes tag special situations so files can be found later.",
    "Example table: Change | New files | Existing files",
    "Example row: URG gets a new meaning | Create a new marker code | Keep the original URG tag.",
    "A code already used on a file cannot be renamed. Inactivate it to stop using it on new files.",
  ],
  tcec: [
    "Purpose: Manages committee names offered in TCEC fields and reports.",
    "Example table: Change | New entries | Existing files",
    "Example row: Add Committee B; inactivate Committee A | Committee B is offered | Previously saved Committee A remains.",
  ],
  thresholds: [
    "Set value bands used across all financial years in Count and Value Analysis.",
    "Choose whether each band applies to Capital, Revenue, or Both.",
  ],
  bgReceiptDelay: [
    "Set the shared delay thresholds used by Reports > BG receipt delay.",
    "A guarantee is counted in a band when it has not been received after the corresponding number of days from the S.O. date.",
  ],
  anomalyGovernance: [
    "The anomaly list contains suspected data issues and accepted/rejected decisions.",
    "Example table: Action | Review status | File data",
    "Example row: Reopen an accepted decision | Available for review again | Unchanged.",
  ],
  milestones: [
    "Purpose: Sets the displayed milestone sequence in Add/Edit and Dashboard Status-2/Status-4; it does not rewrite saved workflow history.",
    "Example table: Change | Display result | Saved data",
    "Example row: Add Technical Review | Appears for every file; do not add it for Contract files only | No completion date is added automatically.",
    "Example row: Move Financial Sanction above Bidding | Sequence changes; Timeline still orders dated events by date | Dates and file progress stay unchanged.",
    "The 'Used in N files' figure counts unique files, including archived files, where this milestone is current or completed on the file, an S.O., an S.O. delivery stage, or its advance-payment record.",
    "Details: Status-1 and Status-3 use their own standard workflow logic, so this sequence does not change their counters.",
    "Included and Excluded: Inactive milestones are excluded from the active sequence, but their saved dates and completion data are not erased immediately.",
    "Included and Excluded: An inactive milestone may no longer appear on a file's checklist.",
    "Add or activate: Add places a new milestone at the selected position.",
    "Add or activate: Activate restores an inactive milestone at the end of the active sequence, just before File Closed.",
    "Reorder: Use the arrows to change the displayed sequence.",
    "Reorder: File Closed remains last, and some standard milestones stay in positions controlled by the software.",
    "Reorder: This sequence breaks ties for events on the same day and orders undated milestones in Show all dates.",
    "Existing milestones are defaults and cannot be deleted. They can be inactivated and activated again; custom milestones can be removed when unused.",
    "Remove: If a file using an inactive milestone is edited and saved, its completion mark for that milestone may be removed.",
    "Caution: Review the 'Used in files' figure before inactivating a milestone, because it may disappear from checklists on files that use it.",
  ],
  presets: [
    "Purpose: Saves reusable Search result and export column selections.",
    "Example table: Selection | Table/export columns | Matching files",
    "Example row: Payment review preset | Shows Control No., Indentor, S.O., and payment details | Unchanged.",
    "Create a preset for a column set used regularly. Use Manual for a one-time column change.",
    "Admin-created presets are shared. Personal presets are visible only to the account that created them.",
  ],
  users: [
    "Manage authorised accounts, roles, and access permissions.",
    "Use the role guide beside the Authorised users heading for role capabilities and limits.",
  ],
  ipAccess: [
    "Controls login access by trusted IP address.",
    "Default mode is Off, so existing login behavior is unchanged unless Admin enables monitoring or restriction.",
    "Notify mode collects real IP addresses before Restrict mode is enabled.",
    "Archived IP attempts can be permanently deleted with your personal deletion password.",
  ],
  archive: [
    "Archived records appear here with restore and permanent-delete actions.",
    "Restore returns an archived setting to active use; permanent deletion removes it and needs your personal deletion password.",
  ],
  archiveSubAdmin: [
    "Shows archived files from your assigned divisions only.",
    "You can permanently delete an archived file with your personal deletion password. Restore and other archive bins remain Admin-only.",
  ],
} satisfies Record<string, string[]>;

const workspaceYearHelpers = {
  setCurrent: [
    "Makes the chosen FY the software's official current FY.",
    "New files will use this year as the current FY.",
    "Global Active-files filter options will treat this FY as the current FY.",
    "Set the Current FY when the office moves to a new financial year.",
  ],
  lockSelection: [
    "When unlocked, new files can be added by selecting any of the two FYs options available on Add File page.",
    "When locked, new files can be added only to current FY.",
    "Unlocked keeps next-FY demands available during an approved transition period.",
  ],
  archive: [
    "Archives the selected FY for normal Search without deleting any files or records.",
    "Inactive files whose origin is this FY are excluded from normal Search; active carry-forward files remain searchable.",
    "Include active files from archived years applies across Search, Dashboard, Reports, Quick Entry, and All Files. When enabled, active carry-forward files from archived FYs remain available; when disabled, all files from archived FYs are excluded. Files individually moved to Archive remain separate.",
    "Archive and restore take effect immediately; there is no separate Save changes step.",
    "The current FY cannot be archived. Only Administrators can archive or restore a FY.",
  ],
} satisfies Record<string, string[]>;

const settingsControlHelpers = {
  genericAdd: [
    "Makes this choice available for new entries.",
    "Existing files keep the value already saved on them.",
  ],
  workspaceDelete: [
    "Deletes only the selected FY from workspace year options.",
    "Current FY and any FY having files cannot be deleted.",
    "Your personal deletion password is required.",
  ],
  firmTypeName: [
    "Firm Type is chosen in Supply Order details.",
    "Example table: Change | New S.O.s | Existing S.O.s",
    "Example row: Replace MSE with a new type | New type is offered; old one can be inactivated | Keep the original MSE value.",
    "Once an S.O. uses a type, its name is protected. Add the replacement and inactivate the old choice.",
  ],
  firmTypeAdd: [
    "Adds a new firm type option for Supply Order firm details.",
    "Users can select this type in S.O. details and see it in related reports.",
  ],
  firmTypeDelete: [
    "Removes this firm type option from Settings.",
    "Unused firm types can be deleted.",
    "To stop offering a used type on new S.O.s, inactivate it. Older S.O.s keep their saved value.",
  ],
  fileTypeGroup: [
    "Goods & Services and Contract file types follow different steps.",
    "Example table: New type | Group | Effect",
    "Example row: AMC | Contract | New AMC files use the Contract workflow.",
    "Select the correct group when adding a type. Once a file uses it, the type's name and group cannot be changed.",
  ],
  fileTypeDelete: [
    "An unused, non-default type can be deleted.",
    "Example table: Type status | Action | Result",
    "Example row: Used on an existing file | Inactivate | No longer offered for new files; old files retain it.",
    "A type used by an active or archived file cannot be deleted or renamed. Inactivate it to stop offering it for new files.",
  ],
  demandProcessingDayRanges: [
    "Used in Reports > Demand processing analysis.",
    "Demand Processing Analysis groups the number of days between two dates into these ranges.",
    "Changing a range changes the grouping only; file dates and measured gaps stay the same.",
  ],
  genericDelete: [
    "Unused choices can be deleted.",
    "Example table: Choice status | Action | Existing records",
    "Example row: Old mode used by a file | Inactivate | File retains its saved mode.",
    "Choices already used by files should be retained for history and inactivated when available.",
  ],
  archiveEntity: [
    "Moves this saved record to Archive; it is not permanently deleted.",
    "Restore it from Settings > Archive when you need it active again.",
  ],
  userDelete: [
    "Moves this user account to Archive and deactivates it; it is not permanently deleted.",
    "Restore it from Settings > Archive to return it to active use.",
    "Your personal verification password is required.",
  ],
  universalViewerCashOutgoScope: [
    "Universal Viewers are read-only MMG users whose data access is limited to their assigned divisions. They can use filters and reports, but cannot manage users or edit core file records.",
    "Type 1 - View only: can vary filters and view results, but cannot save Cash Out Go Plan offsets, row dates, or MER.",
    "Type 2 - Personal Cash Out Go only: can save Cash Out Go Plan offsets and row dates for that Universal Viewer's own account only. It cannot change the official global plan or MER.",
    "Type 3 - Global Cash Out Go + MER: can save the official Cash Out Go Plan, top offsets, row dates, and MER for the software.",
  ],
  archiveRestore: [
    "Restores the archived item back to active records.",
    "Review details after restore if related settings have changed.",
  ],
  archiveDelete: [
    "Permanently deletes the archived item.",
    "Your personal deletion password is required. This action cannot be undone from this screen.",
  ],
  ipMode: [
    "Off leaves login unchanged.",
    "Notify allows login and tells Admin when someone signs in from a new IP.",
    "Restrict allows login only from active addresses in the trusted list.",
  ],
  ipCurrent: [
    "The detected IP address belongs to the current browser/backend request.",
    "Add it as trusted before enabling Restrict mode.",
  ],
  ipAddCurrent: [
    "Adds the currently detected IP to the trusted list.",
    "Add it only when the detected address belongs to an authorised PC.",
  ],
  ipManualAddress: [
    "Enter an IP address that should be trusted for login.",
    "Keep the value exact because Restrict mode checks this address.",
  ],
  ipRemarks: [
    "Remarks can identify the PC, office, user, or location.",
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
    "Archived new-IP login attempts appear here.",
    "Permanent deletion from this bin needs your personal deletion password.",
  ],
  anomalyWorkflow: [
    "Current lists active suspected issues, including rejected or revoked items while the data issue remains.",
    "Received request lists acceptance requests waiting for Admin.",
    "Accepted, rejected, and revoked tabs contain decision history.",
  ],
  anomalyRefresh: [
    "Refresh reloads anomaly requests and decision history.",
    "Refresh after another user submits or reviews an anomaly.",
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
    "The account password is required.",
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
  const knownLabels: Record<string, string> = {
    refloatcycleactivityexistsbutrefloatrecommendationdateisblank:
      "Refloat cycle activity exists but Refloat recommendation date is blank",
    laterstagehaspaymentorbilldateswhileearlierstagedeliveryjobcompletionisincomplete:
      "Later stage has payment or bill dates while earlier stage delivery/job completion is incomplete",
    soisshortclosedbutdeliverypaymentjobcompletioncontinuesaftershortclosuredate:
      "S.O. is shortclosed but delivery/payment/job completion continues after shortclosure date",
    soisshortclosedbutjobcompletionispending: "S.O. is shortclosed but Job Completion is pending",
    soisshortclosedbutmaterialreceiptispending:
      "S.O. is shortclosed but material receipt is pending",
    soisshortclosedbutpaymentispending: "S.O. is shortclosed but payment is pending",
    soisshortclosedbutreturnedbillworkflowispending:
      "S.O. is shortclosed but returned bill workflow is pending",
    soisshortclosedbutsupplementarybillworkflowispending:
      "S.O. is shortclosed but supplementary bill workflow is pending",
  };
  if (knownLabels[value]) return knownLabels[value];
  if (value === "fileclosedbutbgreturnpendingexists") {
    return "File is closed but BG return is still pending";
  }
  if (
    value ===
    "stagedeliveryperiodsoverlapacceptableifstagesruninparallelacceptthisanomalyforthisfileifintentional"
  ) {
    return "Stage delivery periods overlap";
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

function canViewAdminSettings(role: AppUserRole | undefined) {
  return role === "admin" || role === "sub_admin" || role === "universal_viewer";
}

function isUniversalViewer(role: AppUserRole | undefined) {
  return role === "universal_viewer";
}

function canViewAllDivisions(role: AppUserRole | undefined) {
  return role === "admin";
}

type BackupScheduleSettings = {
  enabled: boolean;
  frequency: "daily" | "weekly";
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  destinationDir: string;
  retentionCount: number;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: "idle" | "running" | "success" | "failed";
  lastError: string | null;
  lastFileName: string | null;
  schedulePasswordConfigured: boolean;
  externalStorageConfigured: boolean;
  deploymentConfigConfigured: boolean;
  deploymentSecretsConfigured: boolean;
};

type BackupHealthStatus = "success" | "failed" | "not_run" | "running" | "not_configured";

type BackupStatusItem = {
  status: BackupHealthStatus;
  lastBackupAt: string | null;
  fileName: string | null;
  error: string | null;
  secretsIncluded: boolean;
};

type BackupStatusPayload = {
  local: BackupStatusItem;
  fullRecovery: BackupStatusItem;
  server: BackupStatusItem & { scheduleEnabled: boolean };
  secretFiles: {
    status: BackupHealthStatus;
    configured: boolean;
    readable: boolean;
    lastIncludedAt: string | null;
    lastIncludedFileName: string | null;
    error: string | null;
  };
  restoreAuthorizationConfigured: boolean;
  restoreAuthorizationRecoveryConfigured: boolean;
  schedule: BackupScheduleSettings;
};

const backupScheduleDayOptions = [
  [0, "Sunday"],
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
] as const;

function areBackupScheduleValuesEqual(
  left: BackupScheduleSettings | null | undefined,
  right: BackupScheduleSettings | null | undefined,
) {
  if (!left || !right) return left === right;
  return (
    left.enabled === right.enabled &&
    left.frequency === right.frequency &&
    left.dayOfWeek === right.dayOfWeek &&
    left.timeOfDay === right.timeOfDay &&
    left.destinationDir === right.destinationDir &&
    left.retentionCount === right.retentionCount
  );
}

function formatBackupScheduleDate(value: string | null, timeZone: string) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function backupHealthLabel(status: BackupHealthStatus) {
  if (status === "success") return "Successful";
  if (status === "failed") return "Issue";
  if (status === "running") return "Running";
  if (status === "not_configured") return "Optional / not configured";
  return "Not yet run";
}

function backupHealthClass(status: BackupHealthStatus) {
  if (status === "success") {
    return "bg-emerald-500/10 text-foreground";
  }
  if (status === "failed") {
    return "bg-red-500/10 text-foreground";
  }
  if (status === "running") {
    return "bg-amber-500/10 text-foreground";
  }
  return "bg-background text-foreground";
}

function BackupTypeComparisonTooltip() {
  return (
    <div className="max-w-[min(44rem,calc(100vw-2rem))] space-y-2 text-sm leading-relaxed">
      <p>
        <strong>Database backup (.rbk):</strong> Contains application database records and settings.
        It is smaller and faster, and is intended for routine database recovery after accidental
        changes or data corruption. Restoring it replaces database records.
      </p>
      <p>
        <strong>Full recovery package (.rkdr):</strong> Contains the database backup plus the
        PostgreSQL dump, roles/globals, external storage, and configured deployment files and
        secrets. It is larger and slower, and is intended only for rebuilding or replacing a server
        or recovering from a major disaster. Restoring it can replace the database and selected
        server/deployment files.
      </p>
      <p>
        Secret files are included only when explicitly configured and available; otherwise they must
        be provided separately. Both package types require the file&apos;s encryption password and
        the configured Upload password.
      </p>
      <p>
        Use the database backup for routine recovery. Use the full recovery package only for
        complete server or disaster recovery.
      </p>
    </div>
  );
}

function ProtectedBackupSettings() {
  const draft = useContext(SettingsDraftContext);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [restoreAuthorizationCurrentPassword, setRestoreAuthorizationCurrentPassword] =
    useState("");
  const [currentRestoreAuthorizationStatus, setCurrentRestoreAuthorizationStatus] = useState<
    "idle" | "checking" | "verified" | "invalid"
  >("idle");
  const [restoreAuthorizationRecoveryPin, setRestoreAuthorizationRecoveryPin] = useState("");
  const [
    restoreAuthorizationRecoveryPinConfirmation,
    setRestoreAuthorizationRecoveryPinConfirmation,
  ] = useState("");
  const [recoveryPinInput, setRecoveryPinInput] = useState("");
  const [recoveryPinStatus, setRecoveryPinStatus] = useState<
    "idle" | "checking" | "verified" | "invalid"
  >("idle");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [restoreAuthorizationPassword, setRestoreAuthorizationPassword] = useState("");
  const [restoreAuthorizationConfirmation, setRestoreAuthorizationConfirmation] = useState("");
  const [backupFilePassword, setBackupFilePassword] = useState("");
  const [restoreAuthorizationInput, setRestoreAuthorizationInput] = useState("");
  const [restoreAuthorized, setRestoreAuthorized] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [fullRestoreFile, setFullRestoreFile] = useState<File | null>(null);
  const [fullRestoreFilePassword, setFullRestoreFilePassword] = useState("");
  const [restoreDeploymentFiles, setRestoreDeploymentFiles] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const fullRestoreFileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<
    | "download"
    | "fullDownload"
    | "restore"
    | "fullRestore"
    | "restoreAuthorization"
    | "changeRestoreAuthorizationPassword"
    | "changeRestoreAuthorizationRecoveryPin"
    | "verifyCurrentRestoreAuthorization"
    | "recoverRestoreAuthorization"
    | "authorizeRestore"
    | "schedule"
    | "scheduleRun"
    | ""
  >("");
  const [message, setMessage] = useState("");
  const [schedule, setSchedule] = useState<BackupScheduleSettings | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<BackupScheduleSettings | null>(null);
  const scheduleRef = useRef<BackupScheduleSettings | null>(null);
  const scheduleDraftRef = useRef<BackupScheduleSettings | null>(null);
  const [activeBackupTab, setActiveBackupTab] = useState("backup");
  const [backupStatus, setBackupStatus] = useState<BackupStatusPayload | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const backupPasswordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const backupPasswordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const restoreAuthorizationPasswordsMatch =
    restoreAuthorizationPassword.length > 0 &&
    restoreAuthorizationConfirmation.length > 0 &&
    restoreAuthorizationPassword === restoreAuthorizationConfirmation;
  const restoreAuthorizationPasswordsMismatch =
    restoreAuthorizationConfirmation.length > 0 &&
    restoreAuthorizationPassword !== restoreAuthorizationConfirmation;
  const backupPasswordReady = password.length >= 8 && backupPasswordsMatch;
  const restoreAuthorizationRecoveryPinReady = /^\d{6}$/.test(restoreAuthorizationRecoveryPin);
  const restoreAuthorizationRecoveryPinMatch =
    restoreAuthorizationRecoveryPinReady &&
    /^\d{6}$/.test(restoreAuthorizationRecoveryPinConfirmation) &&
    restoreAuthorizationRecoveryPin === restoreAuthorizationRecoveryPinConfirmation;
  const initialRestoreAuthorizationReady =
    !backupStatus?.restoreAuthorizationConfigured &&
    restoreAuthorizationPassword.length >= 8 &&
    restoreAuthorizationPasswordsMatch &&
    restoreAuthorizationRecoveryPinMatch;
  const changeRestoreAuthorizationPasswordReady =
    Boolean(backupStatus?.restoreAuthorizationConfigured) &&
    currentRestoreAuthorizationStatus === "verified" &&
    restoreAuthorizationPassword.length >= 8 &&
    restoreAuthorizationPasswordsMatch;
  const changeRestoreAuthorizationRecoveryPinReady =
    Boolean(backupStatus?.restoreAuthorizationConfigured) &&
    currentRestoreAuthorizationStatus === "verified" &&
    restoreAuthorizationRecoveryPinMatch;
  const hasRestoreAuthorizationDraft =
    restoreAuthorizationCurrentPassword.length > 0 ||
    restoreAuthorizationPassword.length > 0 ||
    restoreAuthorizationConfirmation.length > 0 ||
    restoreAuthorizationRecoveryPin.length > 0 ||
    restoreAuthorizationRecoveryPinConfirmation.length > 0;
  const recoveryPasswordsMatch =
    recoveryPassword.length > 0 &&
    recoveryConfirmation.length > 0 &&
    recoveryPassword === recoveryConfirmation;
  const recoveryPasswordsMismatch =
    recoveryConfirmation.length > 0 && recoveryPassword !== recoveryConfirmation;
  const restoreAuthorizationRecoveryPinMismatch =
    restoreAuthorizationRecoveryPinConfirmation.length > 0 &&
    restoreAuthorizationRecoveryPin !== restoreAuthorizationRecoveryPinConfirmation;
  const recoveryPinReady = /^\d{6}$/.test(recoveryPinInput);
  const recoveryPinVerified = recoveryPinStatus === "verified";
  const hasBackupSensitiveDraft = Boolean(
    password ||
      confirmPassword ||
      restoreAuthorizationCurrentPassword ||
      restoreAuthorizationPassword ||
      restoreAuthorizationConfirmation ||
      restoreAuthorizationRecoveryPin ||
      restoreAuthorizationRecoveryPinConfirmation ||
      recoveryPinInput ||
      recoveryPassword ||
      recoveryConfirmation ||
      restoreAuthorizationInput ||
      backupFilePassword ||
      fullRestoreFilePassword ||
      restoreFile ||
      fullRestoreFile ||
      restoreAuthorized ||
      restoreDeploymentFiles,
  );

  const passwordFieldClass = (invalid: boolean, valid: boolean) =>
    `h-9 w-full rounded-md border bg-background px-3 text-sm ${
      invalid
        ? "border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/30"
        : valid
          ? "border-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          : "border-input"
    }`;

  const readError = async (response: Response, fallback: string) => {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error || fallback;
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    if (!recoveryPinReady) {
      setRecoveryPinStatus("idle");
      return;
    }

    let cancelled = false;
    setRecoveryPinStatus("checking");
    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/api/settings/protected-backup/restore-authorization/recovery-pin/verify`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recoveryPin: recoveryPinInput }),
          },
        );
        if (!response.ok) {
          throw new Error(await readError(response, "Recovery PIN verification failed."));
        }
        if (!cancelled) {
          setRecoveryPinStatus("verified");
          setMessage("Recovery PIN verified. You can create a replacement Upload password.");
        }
      } catch (error) {
        if (!cancelled) {
          setRecoveryPinStatus("invalid");
          setMessage(error instanceof Error ? error.message : "Recovery PIN verification failed.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, recoveryPinInput, recoveryPinReady]);

  const loadBackupStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/status`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Backup status could not be loaded."));
      }
      const body = (await response.json()) as { status: BackupStatusPayload };
      const nextSchedule = body.status.schedule;
      const preserveDraft =
        scheduleRef.current !== null &&
        scheduleDraftRef.current !== null &&
        !areBackupScheduleValuesEqual(scheduleDraftRef.current, scheduleRef.current);
      scheduleRef.current = nextSchedule;
      if (!preserveDraft) scheduleDraftRef.current = nextSchedule;
      setBackupStatus(body.status);
      setSchedule(nextSchedule);
      if (!preserveDraft) setScheduleDraft(nextSchedule);
    } catch (error) {
      setScheduleMessage(
        error instanceof Error ? error.message : "Backup status could not be loaded.",
      );
    }
  }, [apiBase]);

  useEffect(() => {
    void loadBackupStatus();
  }, [loadBackupStatus]);

  const scheduleDraftDirty = Boolean(
    scheduleDraft && schedule && !areBackupScheduleValuesEqual(scheduleDraft, schedule),
  );
  const updateScheduleDraft = (
    updater: (current: BackupScheduleSettings | null) => BackupScheduleSettings | null,
  ) => {
    setScheduleDraft((current) => {
      const nextDraft = updater(current);
      scheduleDraftRef.current = nextDraft;
      return nextDraft;
    });
  };
  const cancelScheduleDraftRef = useRef<() => void>(() => undefined);
  cancelScheduleDraftRef.current = () => {
    const currentSchedule = scheduleRef.current;
    scheduleDraftRef.current = currentSchedule;
    setScheduleDraft(currentSchedule);
    setScheduleMessage("");
  };

  useEffect(() => {
    draft?.registerExternalDraft?.({
      save: async () => undefined,
      cancel: () => cancelScheduleDraftRef.current(),
    });
    return () => draft?.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setLocalDirty?.(scheduleDraftDirty);
  }, [draft?.setLocalDirty, scheduleDraftDirty]);

  const reloadAfterRestore = async (message: string) => {
    setMessage(`${message} Reloading application and checking the account session...`);
    await store.reload();
    window.location.reload();
  };

  const resetRestoreAuthorizationPasswordDraft = () => {
    setRestoreAuthorizationPassword("");
    setRestoreAuthorizationConfirmation("");
  };

  const resetRestoreAuthorizationRecoveryPinDraft = () => {
    setRestoreAuthorizationRecoveryPin("");
    setRestoreAuthorizationRecoveryPinConfirmation("");
  };

  const resetRestoreAuthorizationDraft = () => {
    setRestoreAuthorizationCurrentPassword("");
    setCurrentRestoreAuthorizationStatus("idle");
    resetRestoreAuthorizationPasswordDraft();
    resetRestoreAuthorizationRecoveryPinDraft();
  };

  const clearBackupSensitiveState = () => {
    setPassword("");
    setConfirmPassword("");
    resetRestoreAuthorizationDraft();
    setRecoveryPinInput("");
    setRecoveryPinStatus("idle");
    setRecoveryPassword("");
    setRecoveryConfirmation("");
    setRestoreAuthorizationInput("");
    setBackupFilePassword("");
    setFullRestoreFilePassword("");
    setRestoreFile(null);
    setFullRestoreFile(null);
    setRestoreAuthorized(false);
    setRestoreDeploymentFiles(false);
    if (backupFileInputRef.current) backupFileInputRef.current.value = "";
    if (fullRestoreFileInputRef.current) fullRestoreFileInputRef.current.value = "";
  };

  const handleBackupTabChange = async (value: string) => {
    if (value === activeBackupTab) return;
    if (hasAnyUnsavedChanges() || hasBackupSensitiveDraft) {
      const confirmed = await showAppConfirm(
        "You have unsaved changes. Leave this Protected Backup tab without saving?",
      );
      if (!confirmed) return;
      cancelScheduleDraftRef.current();
      draft?.setLocalDirty?.(false);
    }
    clearBackupSensitiveState();
    setMessage("");
    setScheduleMessage("");
    setStatusMessage("");
    setActiveBackupTab(value);
  };

  const verifyCurrentRestoreAuthorization = async () => {
    if (restoreAuthorizationCurrentPassword.length < 8) {
      setCurrentRestoreAuthorizationStatus("invalid");
      setMessage("Enter the current Upload password first.");
      return;
    }
    setBusy("verifyCurrentRestoreAuthorization");
    setCurrentRestoreAuthorizationStatus("checking");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBase}/api/settings/protected-backup/restore-authorization/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: restoreAuthorizationCurrentPassword }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Current Upload password is incorrect."));
      }
      setCurrentRestoreAuthorizationStatus("verified");
      setMessage("Current Upload password verified. Choose the activity you want to complete below.");
    } catch (error) {
      setCurrentRestoreAuthorizationStatus("invalid");
      setMessage(error instanceof Error ? error.message : "Current Upload password is incorrect.");
    } finally {
      setBusy("");
    }
  };

  const recoverRestoreAuthorization = async () => {
    if (!recoveryPinVerified) {
      setMessage(
        recoveryPinReady
          ? "Verify the Recovery PIN before creating a replacement password."
          : "Enter the six-digit numeric Recovery PIN first.",
      );
      return;
    }
    if (recoveryPassword.length < 8) {
      setMessage("Use an Upload password with at least 8 characters.");
      return;
    }
    if (!recoveryPasswordsMatch) {
      setMessage("Upload passwords do not match.");
      return;
    }
    if (
      !(await showAppConfirm("Reset the Upload password? The old Upload password will stop working.", {
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy("recoverRestoreAuthorization");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBase}/api/settings/protected-backup/restore-authorization/recover`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recoveryPin: recoveryPinInput,
            password: recoveryPassword,
            confirmation: recoveryConfirmation,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Upload password could not be reset."));
      }
      resetRestoreAuthorizationDraft();
      setRecoveryPinInput("");
      setRecoveryPassword("");
      setRecoveryConfirmation("");
      setRestoreAuthorized(false);
      setMessage("Upload password reset successfully. Use the new password for future restores.");
      await loadBackupStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload password could not be reset.");
    } finally {
      setBusy("");
    }
  };

  const initializeRestoreAuthorization = async () => {
    if (backupStatus?.restoreAuthorizationConfigured) {
      setMessage("The Upload password is already set. Use the change workflows below.");
      return;
    }
    if (restoreAuthorizationPassword.length < 8) {
      setMessage("Use an Upload password with at least 8 characters.");
      return;
    }
    if (!restoreAuthorizationPasswordsMatch) {
      setMessage("Upload passwords do not match.");
      return;
    }
    if (!restoreAuthorizationRecoveryPinReady) {
      setMessage("Use exactly six numeric digits for the Recovery PIN.");
      return;
    }
    if (!restoreAuthorizationRecoveryPinMatch) {
      setMessage("Recovery PINs do not match.");
      return;
    }
    setBusy("restoreAuthorization");
    setRestoreAuthorized(false);
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/restore-authorization`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: restoreAuthorizationPassword,
          confirmation: restoreAuthorizationConfirmation,
          recoveryPin: restoreAuthorizationRecoveryPin,
          recoveryPinConfirmation: restoreAuthorizationRecoveryPinConfirmation,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Upload password setup could not be saved."));
      }
      resetRestoreAuthorizationDraft();
      setMessage("Upload password and Recovery PIN configured. You can now create or restore backups.");
      await loadBackupStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload password setup could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const changeRestoreAuthorizationPassword = async () => {
    if (!backupStatus?.restoreAuthorizationConfigured) {
      setMessage("Set up the Upload password first.");
      return;
    }
    if (currentRestoreAuthorizationStatus !== "verified") {
      setMessage("Complete Step 1 by verifying the current Upload password.");
      return;
    }
    if (restoreAuthorizationPassword.length < 8) {
      setMessage("Use an Upload password with at least 8 characters.");
      return;
    }
    if (!restoreAuthorizationPasswordsMatch) {
      setMessage("Upload passwords do not match.");
      return;
    }
    if (
      !(await showAppConfirm("Change the Upload password? The old password will stop working.", {
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy("changeRestoreAuthorizationPassword");
    setRestoreAuthorized(false);
    setMessage("");
    try {
      const response = await fetch(
        `${apiBase}/api/settings/protected-backup/restore-authorization/password`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: restoreAuthorizationCurrentPassword,
            password: restoreAuthorizationPassword,
            confirmation: restoreAuthorizationConfirmation,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Upload password could not be changed."));
      }
      setRestoreAuthorizationCurrentPassword("");
      setCurrentRestoreAuthorizationStatus("idle");
      setRestoreAuthorizationPassword("");
      setRestoreAuthorizationConfirmation("");
      setMessage("Upload password changed successfully. Use the new password for future restores.");
      await loadBackupStatus();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Upload password could not be changed.";
      if (/current (?:restore authorization|upload) password is incorrect/i.test(errorMessage)) {
        setCurrentRestoreAuthorizationStatus("invalid");
      }
      setMessage(errorMessage);
    } finally {
      setBusy("");
    }
  };

  const changeRestoreAuthorizationRecoveryPin = async () => {
    if (!backupStatus?.restoreAuthorizationConfigured) {
      setMessage("Set up the Upload password first.");
      return;
    }
    if (currentRestoreAuthorizationStatus !== "verified") {
      setMessage("Complete Step 1 by verifying the current Upload password.");
      return;
    }
    if (!restoreAuthorizationRecoveryPinReady) {
      setMessage("Use exactly six numeric digits for the Recovery PIN.");
      return;
    }
    if (!restoreAuthorizationRecoveryPinMatch) {
      setMessage("Recovery PINs do not match.");
      return;
    }
    if (!(await showAppConfirm("Change the Recovery PIN? The old PIN will stop working."))) {
      return;
    }
    setBusy("changeRestoreAuthorizationRecoveryPin");
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/restore-authorization`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: restoreAuthorizationCurrentPassword,
          recoveryPin: restoreAuthorizationRecoveryPin,
          recoveryPinConfirmation: restoreAuthorizationRecoveryPinConfirmation,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Recovery PIN could not be changed."));
      }
      setRestoreAuthorizationCurrentPassword("");
      setCurrentRestoreAuthorizationStatus("idle");
      setRestoreAuthorizationRecoveryPin("");
      setRestoreAuthorizationRecoveryPinConfirmation("");
      setMessage("Recovery PIN changed successfully.");
      await loadBackupStatus();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Recovery PIN could not be changed.";
      if (/current (?:restore authorization|upload) password is incorrect/i.test(errorMessage)) {
        setCurrentRestoreAuthorizationStatus("invalid");
      }
      setMessage(errorMessage);
    } finally {
      setBusy("");
    }
  };

  const authorizeRestore = async () => {
    if (restoreAuthorizationInput.length < 8) {
      setMessage("Enter the Upload password first.");
      return;
    }
    setBusy("authorizeRestore");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBase}/api/settings/protected-backup/restore-authorization/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: restoreAuthorizationInput }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Upload password verification failed."));
      }
      setRestoreAuthorized(true);
      setMessage("Restore authorized. You can now select the backup file.");
    } catch (error) {
      setRestoreAuthorized(false);
      setMessage(error instanceof Error ? error.message : "Upload password verification failed.");
    } finally {
      setBusy("");
    }
  };

  const saveBackupSchedule = async () => {
    if (!scheduleDraft) return;
    setBusy("schedule");
    setScheduleMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/schedule`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: scheduleDraft.enabled,
          frequency: scheduleDraft.frequency,
          dayOfWeek: scheduleDraft.dayOfWeek,
          timeOfDay: scheduleDraft.timeOfDay,
          destinationDir: scheduleDraft.destinationDir,
          retentionCount: scheduleDraft.retentionCount,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Backup schedule could not be saved."));
      }
      const body = (await response.json()) as { schedule: BackupScheduleSettings };
      scheduleRef.current = body.schedule;
      scheduleDraftRef.current = body.schedule;
      setSchedule(body.schedule);
      setScheduleDraft(body.schedule);
      setScheduleMessage("Scheduled server backup settings saved.");
      await loadBackupStatus();
    } catch (error) {
      setScheduleMessage(
        error instanceof Error ? error.message : "Backup schedule could not be saved.",
      );
    } finally {
      setBusy("");
    }
  };

  const runScheduledBackupNow = async () => {
    setBusy("scheduleRun");
    setScheduleMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/schedule/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Scheduled server backup could not be started."));
      }
      const body = (await response.json()) as { schedule: BackupScheduleSettings };
      scheduleRef.current = body.schedule;
      setSchedule(body.schedule);
      setScheduleMessage("Scheduled server backup completed successfully.");
      await loadBackupStatus();
    } catch (error) {
      setScheduleMessage(
        error instanceof Error ? error.message : "Scheduled server backup could not be started.",
      );
      await loadBackupStatus();
    } finally {
      setBusy("");
    }
  };

  const downloadBackup = async () => {
    if (password.length < 8) {
      setMessage("Use a Backup encryption password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Backup encryption passwords must match.");
      return;
    }
    setBusy("download");
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await readError(response, "Backup could not be created."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.download = `recordkeeper-backup-${timestamp}.rbk`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Database backup downloaded. Store it in a second safe location.");
      await loadBackupStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup could not be created.");
    } finally {
      setBusy("");
    }
  };

  const restoreBackup = async () => {
    if (!restoreAuthorized) {
      setMessage("Authorize restore before selecting or restoring a backup.");
      return;
    }
    if (!restoreFile) {
      setMessage("Choose a .rbk backup file first.");
      return;
    }
    if (backupFilePassword.length < 8) {
      setMessage("Enter the password used to encrypt the selected backup file.");
      return;
    }
    if (restoreAuthorizationInput.length < 8) {
      setMessage("Enter the Upload password.");
      return;
    }
    if (
      !(await showAppConfirm("Restore this backup? Current database records will be replaced.", {
        destructive: true,
      }))
    )
      return;
    setBusy("restore");
    setMessage("");
    try {
      const backup = JSON.parse(await restoreFile.text());
      const response = await fetch(`${apiBase}/api/settings/protected-backup/restore`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupFilePassword,
          restoreAuthorizationPassword: restoreAuthorizationInput,
          backup,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Backup could not be restored."));
      const result = (await response.json()) as { tables?: number; rows?: number };
      setRestoreFile(null);
      await reloadAfterRestore(
        `Backup restored: ${result.tables ?? 0} tables and ${result.rows ?? 0} rows.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup could not be restored.");
    } finally {
      setBusy("");
    }
  };

  const restoreFullRecoveryPackage = async () => {
    if (!restoreAuthorized) {
      setMessage(
        "Enter the Upload password before selecting or restoring a Full recovery package.",
      );
      return;
    }
    if (!fullRestoreFile) {
      setMessage("Choose a Full recovery package (.rkdr) first.");
      return;
    }
    if (fullRestoreFilePassword.length < 8) {
      setMessage("Enter the Full recovery package encryption password.");
      return;
    }
    if (restoreAuthorizationInput.length < 8) {
      setMessage("Enter the Upload password.");
      return;
    }
    if (
      !(await showAppConfirm(
        "Restore this full recovery package? The server database will be replaced, and uploaded files may also be replaced.",
        { destructive: true },
      ))
    )
      return;
    setBusy("fullRestore");
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/full-restore`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Backup-File-Password": fullRestoreFilePassword,
          "X-Restore-Authorization-Password": restoreAuthorizationInput,
          "X-Restore-Deployment-Files": restoreDeploymentFiles ? "true" : "false",
        },
        body: fullRestoreFile,
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Full recovery package could not be restored."));
      }
      const result = (await response.json()) as { warnings?: string[] };
      const warnings = result.warnings?.length ? ` Warnings: ${result.warnings.join(" ")}` : "";
      setFullRestoreFile(null);
      setFullRestoreFilePassword("");
      if (fullRestoreFileInputRef.current) fullRestoreFileInputRef.current.value = "";
      await reloadAfterRestore(`Full recovery package restored on the server.${warnings}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Full recovery package could not be restored.",
      );
    } finally {
      setBusy("");
    }
  };

  const downloadFullRecoveryPackage = async () => {
    if (password.length < 8) {
      setMessage("Use a Backup encryption password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Backup encryption passwords must match.");
      return;
    }
    setBusy("fullDownload");
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/settings/protected-backup/full-export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error(await readError(response, "Full recovery package could not be created."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.download = `recordkeeper-disaster-recovery-${timestamp}.rkdr`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        "Full recovery package downloaded. Keep it outside the server and transfer it only through a secure channel.",
      );
      await loadBackupStatus();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Full recovery package could not be created.",
      );
    } finally {
      setBusy("");
    }
  };

  const closeProtectedBackupEditor = () => {
    clearBackupSensitiveState();
    scheduleDraftRef.current = schedule;
    setScheduleDraft(schedule);
    setMessage("");
    setScheduleMessage("");
    draft?.actions?.cancelChanges();
  };

  const statusTimeZone = backupStatus?.schedule.timezone ?? schedule?.timezone ?? "Asia/Kolkata";
  const renderBackupStatusButton = (
    label: string,
    item: BackupStatusItem,
    showTypeComparison = false,
  ) => {
    const button = (
      <button
        type="button"
        onClick={() =>
          setStatusMessage(
            item.error ??
              `${label}: ${backupHealthLabel(item.status)}${
                item.fileName ? ` — ${item.fileName}` : ""
              }`,
          )
        }
        aria-label={`${label}: ${backupHealthLabel(item.status)}`}
        className={`inline-flex min-h-12 w-full min-w-0 max-w-full flex-col items-start justify-center break-words rounded-md px-3 py-2 text-left text-xs font-medium whitespace-normal ${backupHealthClass(item.status)}`}
      >
        <span>
          {label}: {backupHealthLabel(item.status)}
        </span>
        <span className="font-normal opacity-80">
          {item.lastBackupAt
            ? `Last: ${formatBackupScheduleDate(item.lastBackupAt, statusTimeZone)}`
            : "No backup recorded"}
        </span>
      </button>
    );

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-[min(44rem,calc(100vw-2rem))] border border-border bg-background p-3 text-foreground shadow-lg"
        >
          {showTypeComparison ? (
            <BackupTypeComparisonTooltip />
          ) : (
            <p className="text-sm leading-relaxed">
              Scheduled server backups run automatically on the server according to the saved
              schedule.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderSecretStatusButton = () => {
    if (!backupStatus) return null;
    const secret = backupStatus.secretFiles;
    const includedAt = secret.lastIncludedAt
      ? formatBackupScheduleDate(secret.lastIncludedAt, statusTimeZone)
      : null;
    const button = (
      <button
        type="button"
        onClick={() =>
          setStatusMessage(
            secret.error ??
              `Secret file included in ${secret.lastIncludedFileName ?? "the latest package"}${
                includedAt ? ` on ${includedAt}` : ""
              }.`,
          )
        }
        aria-label={secret.error ?? "Secret file status"}
        className={`inline-flex min-h-12 w-full min-w-0 max-w-full flex-col items-start justify-center break-words rounded-md px-3 py-2 text-left text-xs font-medium whitespace-normal ${backupHealthClass(secret.status)}`}
      >
        <span>Secret files: {backupHealthLabel(secret.status)}</span>
        <span className="font-normal opacity-80">
          {includedAt ? `Included: ${includedAt}` : "Not included in a package"}
        </span>
      </button>
    );

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="border border-border bg-background p-3 text-foreground shadow-lg"
        >
          <p className="text-sm leading-relaxed">
            Secret files are optional and included only when explicitly configured and available.
          </p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <section className="protected-backup-settings min-w-0 w-full max-w-full rounded-md border border-border bg-secondary/20 p-4 text-[0.9375rem] shadow-sm [&_.text-xs]:text-sm">
      <Tabs
        value={activeBackupTab}
        onValueChange={(value) => void handleBackupTabChange(value)}
        className="mt-0"
      >
        <div className="flex flex-col items-stretch gap-3 border-b border-border pb-4">
          <TabsList className="flex h-auto min-w-0 w-full flex-wrap justify-start gap-1 rounded-md border border-primary/30 bg-primary/5 p-1 shadow-sm">
            <TabsTrigger
              value="backup"
              className="min-h-10 min-w-0 flex-1 gap-2 whitespace-normal px-4 text-center text-base leading-5 font-semibold data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-2 data-[state=active]:ring-primary/20 data-[state=inactive]:text-foreground data-[state=inactive]:hover:bg-primary/10"
            >
              <DatabaseBackup className="size-4" />
              Backup Settings
            </TabsTrigger>
            <TabsTrigger
              value="password"
              className="min-h-10 min-w-0 flex-1 gap-2 whitespace-normal px-4 text-center text-base leading-5 font-semibold data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-2 data-[state=active]:ring-primary/20 data-[state=inactive]:text-foreground data-[state=inactive]:hover:bg-primary/10"
            >
              <Lock className="size-4 shrink-0" />
              Upload Settings
            </TabsTrigger>
            <TabsTrigger
              value="local"
              className="min-h-10 min-w-0 flex-1 gap-2 whitespace-normal px-4 text-center text-base leading-5 font-semibold data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-2 data-[state=active]:ring-primary/20 data-[state=inactive]:text-foreground data-[state=inactive]:hover:bg-primary/10"
            >
              <Upload className="size-4 shrink-0" />
              Upload &amp; restore database backup (.rbk)
            </TabsTrigger>
            <TabsTrigger
              value="full"
              className="min-h-10 min-w-0 flex-1 gap-2 whitespace-normal px-4 text-center text-base leading-5 font-semibold data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-2 data-[state=active]:ring-primary/20 data-[state=inactive]:text-foreground data-[state=inactive]:hover:bg-primary/10"
            >
              <Upload className="size-4 shrink-0" />
              Upload &amp; restore full recovery package (.rkdr)
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <SettingsScope scope="shared" editors="Administrators" />
          {draft?.actions ? (
            <button
              type="button"
              onClick={closeProtectedBackupEditor}
              disabled={draft.actions.saving}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              Close editor
            </button>
          ) : draft?.unlockSection ? (
            <button
              type="button"
              onClick={draft.unlockSection}
              disabled={draft.sectionVerifying || draft.sectionSaving}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-60"
            >
              <Lock className="size-4" />
              {draft.sectionVerifying ? "Checking..." : "Edit"}
            </button>
          ) : null}
        </div>
        <fieldset
          disabled={!draft?.sectionUnlocked || draft?.sectionSaving}
          className={
            !draft?.sectionUnlocked
              ? "pointer-events-none opacity-70 [&_*]:cursor-not-allowed"
              : undefined
          }
        >
          <TabsContent
            value="backup"
            className="protected-backup-tab mt-5 min-w-0 w-full max-w-full space-y-5"
          >
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">Create a database backup</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use one encryption password for the downloaded backup files. Remember this
                  password and keep it different from the Upload password.
                </p>
              </div>
              <div className="protected-backup-action-grid grid min-w-0 w-full max-w-full grid-cols-1 items-end gap-x-4 gap-y-4 sm:grid-cols-2 2xl:grid-cols-4">
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">Backup encryption password</span>
                  <PasswordInput
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">
                    Confirm encryption password
                  </span>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter password"
                    aria-invalid={backupPasswordsMismatch}
                    className={passwordFieldClass(backupPasswordsMismatch, backupPasswordsMatch)}
                  />
                  {backupPasswordsMismatch ? (
                    <p className="mt-1 text-xs text-destructive" role="alert">
                      Backup encryption passwords do not match.
                    </p>
                  ) : backupPasswordsMatch ? (
                    <p
                      className="mt-1 text-xs text-emerald-700 dark:text-emerald-300"
                      role="status"
                    >
                      Backup encryption passwords match.
                    </p>
                  ) : null}
                </label>
                <button
                  type="button"
                  onClick={() => void downloadBackup()}
                  disabled={Boolean(busy) || !backupPasswordReady}
                  className="inline-flex h-10 min-w-0 w-full max-w-full items-center justify-center justify-self-start gap-2 whitespace-normal rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {busy === "download" ? "Creating..." : "Download database backup"}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadFullRecoveryPackage()}
                  disabled={Boolean(busy) || !backupPasswordReady}
                  className="inline-flex h-10 min-w-0 w-full max-w-full items-center justify-center justify-self-start gap-2 whitespace-normal rounded-md border border-primary/40 bg-primary/10 px-3 text-center text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {busy === "fullDownload" ? "Creating..." : "Download full recovery package"}
                </button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="password" className="mt-5 space-y-5">
            {!backupStatus ? (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-5 text-sm text-muted-foreground">
                Loading Upload Settings...
              </div>
            ) : backupStatus.restoreAuthorizationConfigured ? (
              <>
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Step 1
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-foreground">
                        Verify your current Upload password
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Required before changing the Upload password or Recovery PIN.
                      </p>
                    </div>
                    <span
                      className={`inline-flex min-h-8 items-center rounded-md border px-3 py-1 text-sm font-medium ${
                        currentRestoreAuthorizationStatus === "verified"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                          : "border-amber-500/30 bg-amber-500/10 text-foreground"
                      }`}
                      role="status"
                    >
                      Current password: {currentRestoreAuthorizationStatus === "verified" ? "Verified" : "Required"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,28rem)_auto]">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">Current Upload password</span>
                      <PasswordInput
                        value={restoreAuthorizationCurrentPassword}
                        onChange={(event) => {
                          setRestoreAuthorizationCurrentPassword(event.target.value);
                          setCurrentRestoreAuthorizationStatus("idle");
                          setMessage("");
                        }}
                        placeholder="Enter the saved password"
                        aria-invalid={currentRestoreAuthorizationStatus === "invalid"}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void verifyCurrentRestoreAuthorization()}
                      disabled={
                        Boolean(busy) || restoreAuthorizationCurrentPassword.length < 8
                      }
                      className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                    >
                      {busy === "verifyCurrentRestoreAuthorization"
                        ? "Verifying..."
                        : "Verify current password"}
                    </button>
                  </div>
                  {currentRestoreAuthorizationStatus === "verified" ? (
                    <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                      Verified. You can now choose either change workflow below.
                    </p>
                  ) : currentRestoreAuthorizationStatus === "invalid" ? (
                    <p className="mt-3 text-sm text-destructive" role="alert">
                      Current password did not match.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-5 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Step 2A
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-foreground">
                      Change Upload password
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Changes only the password used to authorize database restores. Your Recovery PIN stays the same.
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">New Upload password</span>
                      <PasswordInput
                        value={restoreAuthorizationPassword}
                        onChange={(event) => setRestoreAuthorizationPassword(event.target.value)}
                        placeholder="At least 8 characters"
                        disabled={currentRestoreAuthorizationStatus !== "verified"}
                        className={passwordFieldClass(
                          restoreAuthorizationPasswordsMismatch,
                          restoreAuthorizationPasswordsMatch,
                        )}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">
                        Confirm new Upload password
                      </span>
                      <PasswordInput
                        value={restoreAuthorizationConfirmation}
                        onChange={(event) => setRestoreAuthorizationConfirmation(event.target.value)}
                        placeholder="Re-enter new password"
                        aria-invalid={restoreAuthorizationPasswordsMismatch}
                        disabled={currentRestoreAuthorizationStatus !== "verified"}
                        className={passwordFieldClass(
                          restoreAuthorizationPasswordsMismatch,
                          restoreAuthorizationPasswordsMatch,
                        )}
                      />
                      {restoreAuthorizationPasswordsMismatch ? (
                        <p className="mt-1 text-sm text-destructive" role="alert">
                          Upload passwords do not match.
                        </p>
                      ) : restoreAuthorizationPasswordsMatch ? (
                        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                          Upload passwords match.
                        </p>
                      ) : null}
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void changeRestoreAuthorizationPassword()}
                      disabled={Boolean(busy) || !changeRestoreAuthorizationPasswordReady}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <Save className="size-4" />
                      {busy === "changeRestoreAuthorizationPassword"
                        ? "Changing..."
                        : "Change Upload password"}
                    </button>
                    <button
                      type="button"
                      onClick={resetRestoreAuthorizationPasswordDraft}
                      disabled={Boolean(busy) || (!restoreAuthorizationPassword && !restoreAuthorizationConfirmation)}
                      className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      Clear
                    </button>
                    {currentRestoreAuthorizationStatus !== "verified" ? (
                      <span className="text-sm text-muted-foreground">
                        Verify the current password in Step 1 first.
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-5 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Step 2B
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-foreground">
                      Set or change Recovery PIN
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The Recovery PIN is used only when the Upload password is forgotten. Changing it does not change the Upload password.
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">New Recovery PIN</span>
                      <PasswordInput
                        value={restoreAuthorizationRecoveryPin}
                        onChange={(event) =>
                          setRestoreAuthorizationRecoveryPin(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder="Six numeric digits"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        disabled={currentRestoreAuthorizationStatus !== "verified"}
                        className={passwordFieldClass(
                          restoreAuthorizationRecoveryPinMismatch ||
                            (restoreAuthorizationRecoveryPin.length > 0 &&
                              !restoreAuthorizationRecoveryPinReady),
                          restoreAuthorizationRecoveryPinReady,
                        )}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">Confirm Recovery PIN</span>
                      <PasswordInput
                        value={restoreAuthorizationRecoveryPinConfirmation}
                        onChange={(event) =>
                          setRestoreAuthorizationRecoveryPinConfirmation(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder="Re-enter PIN"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        aria-invalid={restoreAuthorizationRecoveryPinMismatch}
                        disabled={currentRestoreAuthorizationStatus !== "verified"}
                        className={passwordFieldClass(
                          restoreAuthorizationRecoveryPinMismatch,
                          restoreAuthorizationRecoveryPinMatch,
                        )}
                      />
                      {restoreAuthorizationRecoveryPinMismatch ? (
                        <p className="mt-1 text-sm text-destructive" role="alert">
                          Recovery PINs do not match.
                        </p>
                      ) : restoreAuthorizationRecoveryPinMatch ? (
                        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                          Recovery PINs match.
                        </p>
                      ) : null}
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void changeRestoreAuthorizationRecoveryPin()}
                      disabled={Boolean(busy) || !changeRestoreAuthorizationRecoveryPinReady}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <Save className="size-4" />
                      {busy === "changeRestoreAuthorizationRecoveryPin"
                        ? "Changing..."
                        : backupStatus.restoreAuthorizationRecoveryConfigured
                          ? "Change Recovery PIN"
                          : "Save Recovery PIN"}
                    </button>
                    <button
                      type="button"
                      onClick={resetRestoreAuthorizationRecoveryPinDraft}
                      disabled={Boolean(busy) || !restoreAuthorizationRecoveryPin}
                      className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      Clear
                    </button>
                    {currentRestoreAuthorizationStatus !== "verified" ? (
                      <span className="text-sm text-muted-foreground">
                        Verify the current password in Step 1 first.
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Step 2C
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-foreground">
                      Forgot Upload password?
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use the Recovery PIN to create a replacement password without the old password.
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">Recovery PIN</span>
                      <PasswordInput
                        value={recoveryPinInput}
                        onChange={(event) => {
                          const nextPin = event.target.value.replace(/\D/g, "").slice(0, 6);
                          setRecoveryPinInput(nextPin);
                          setRecoveryPinStatus("idle");
                          setRecoveryPassword("");
                          setRecoveryConfirmation("");
                          setMessage("");
                        }}
                        placeholder="Six numeric digits"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        aria-invalid={recoveryPinStatus === "invalid"}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      />
                      {recoveryPinStatus === "checking" ? (
                        <p className="mt-1 text-sm text-muted-foreground" role="status">
                          Verifying Recovery PIN...
                        </p>
                      ) : recoveryPinStatus === "verified" ? (
                        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                          Recovery PIN verified.
                        </p>
                      ) : recoveryPinStatus === "invalid" ? (
                        <p className="mt-1 text-sm text-destructive" role="alert">
                          Recovery PIN is incorrect.
                        </p>
                      ) : null}
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">New Upload password</span>
                      <PasswordInput
                        value={recoveryPassword}
                        onChange={(event) => setRecoveryPassword(event.target.value)}
                        placeholder="At least 8 characters"
                        disabled={!recoveryPinVerified}
                        className={passwordFieldClass(
                          recoveryPasswordsMismatch,
                          recoveryPasswordsMatch,
                        )}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">
                        Confirm new Upload password
                      </span>
                      <PasswordInput
                        value={recoveryConfirmation}
                        onChange={(event) => setRecoveryConfirmation(event.target.value)}
                        placeholder="Re-enter new password"
                        disabled={!recoveryPinVerified}
                        aria-invalid={recoveryPasswordsMismatch}
                        className={passwordFieldClass(
                          recoveryPasswordsMismatch,
                          recoveryPasswordsMatch,
                        )}
                      />
                      {recoveryPasswordsMismatch ? (
                        <p className="mt-1 text-sm text-destructive" role="alert">
                          Upload passwords do not match.
                        </p>
                      ) : recoveryPasswordsMatch ? (
                        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                          Upload passwords match.
                        </p>
                      ) : null}
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void recoverRestoreAuthorization()}
                      disabled={
                        Boolean(busy) ||
                        !backupStatus.restoreAuthorizationRecoveryConfigured ||
                        !recoveryPinVerified ||
                        !recoveryPasswordsMatch
                      }
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-700/40 bg-amber-600 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busy === "recoverRestoreAuthorization"
                        ? "Resetting..."
                        : "Reset Upload password"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryPinInput("");
                        setRecoveryPinStatus("idle");
                        setRecoveryPassword("");
                        setRecoveryConfirmation("");
                      }}
                      disabled={Boolean(busy) || (!recoveryPinInput && !recoveryPassword && !recoveryConfirmation)}
                      className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      Clear
                    </button>
                    {!backupStatus.restoreAuthorizationRecoveryConfigured ? (
                      <span className="text-sm text-muted-foreground">
                        Set a Recovery PIN in Step 2B before using this workflow.
                      </span>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-5 shadow-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    First-time setup
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-foreground">
                    Set up Upload password and Recovery PIN
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This is required before anyone can authorize a database restore. Create both credentials together.
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-sm font-medium">Upload password</span>
                    <PasswordInput
                      value={restoreAuthorizationPassword}
                      onChange={(event) => setRestoreAuthorizationPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-sm font-medium">Confirm Upload password</span>
                    <PasswordInput
                      value={restoreAuthorizationConfirmation}
                      onChange={(event) => setRestoreAuthorizationConfirmation(event.target.value)}
                      placeholder="Re-enter password"
                      aria-invalid={restoreAuthorizationPasswordsMismatch}
                      className={passwordFieldClass(
                        restoreAuthorizationPasswordsMismatch,
                        restoreAuthorizationPasswordsMatch,
                      )}
                    />
                    {restoreAuthorizationPasswordsMismatch ? (
                      <p className="mt-1 text-sm text-destructive" role="alert">
                        Upload passwords do not match.
                      </p>
                    ) : restoreAuthorizationPasswordsMatch ? (
                      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                        Upload passwords match.
                      </p>
                    ) : null}
                  </label>
                </div>
                <div className="mt-5 border-t border-border pt-4">
                  <h4 className="text-base font-semibold text-foreground">Recovery PIN</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep this six-digit PIN somewhere safe. It is the backup way to reset a forgotten Upload password.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">Recovery PIN</span>
                      <PasswordInput
                        value={restoreAuthorizationRecoveryPin}
                        onChange={(event) =>
                          setRestoreAuthorizationRecoveryPin(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder="Six numeric digits"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        className={passwordFieldClass(
                          restoreAuthorizationRecoveryPin.length > 0 &&
                            !restoreAuthorizationRecoveryPinReady,
                          restoreAuthorizationRecoveryPinReady,
                        )}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-sm font-medium">Confirm Recovery PIN</span>
                      <PasswordInput
                        value={restoreAuthorizationRecoveryPinConfirmation}
                        onChange={(event) =>
                          setRestoreAuthorizationRecoveryPinConfirmation(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder="Re-enter PIN"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        aria-invalid={restoreAuthorizationRecoveryPinMismatch}
                        className={passwordFieldClass(
                          restoreAuthorizationRecoveryPinMismatch,
                          restoreAuthorizationRecoveryPinMatch,
                        )}
                      />
                      {restoreAuthorizationRecoveryPinMismatch ? (
                        <p className="mt-1 text-sm text-destructive" role="alert">
                          Recovery PINs do not match.
                        </p>
                      ) : restoreAuthorizationRecoveryPinMatch ? (
                        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                          Recovery PINs match.
                        </p>
                      ) : null}
                    </label>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void initializeRestoreAuthorization()}
                    disabled={Boolean(busy) || !initialRestoreAuthorizationReady}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    {busy === "restoreAuthorization"
                      ? "Saving..."
                      : "Set Upload password and Recovery PIN"}
                  </button>
                  <button
                    type="button"
                    onClick={resetRestoreAuthorizationDraft}
                    disabled={Boolean(busy) || !hasRestoreAuthorizationDraft}
                    className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            {backupStatus ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`inline-flex min-h-8 items-center rounded-md border px-3 py-1 font-medium ${
                    backupStatus.restoreAuthorizationConfigured
                      ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                      : "border-amber-500/30 bg-amber-500/10 text-foreground"
                  }`}
                  role="status"
                >
                  Upload password: {backupStatus.restoreAuthorizationConfigured ? "Set" : "Not set"}
                </span>
                <span
                  className={`inline-flex min-h-8 items-center rounded-md border px-3 py-1 font-medium ${
                    backupStatus.restoreAuthorizationRecoveryConfigured
                      ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                      : "border-amber-500/30 bg-amber-500/10 text-foreground"
                  }`}
                  role="status"
                >
                  Recovery PIN: {backupStatus.restoreAuthorizationRecoveryConfigured ? "Set" : "Not set"}
                </span>
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="backup" className="mt-5 space-y-5">
            {backupStatus ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">Backup Status</h3>
                </div>
                <TooltipProvider delayDuration={0}>
                  <div className="protected-backup-status-grid grid min-w-0 w-full max-w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {renderBackupStatusButton("Database backup", backupStatus.local, true)}
                    {renderBackupStatusButton(
                      "Full recovery package",
                      backupStatus.fullRecovery,
                      true,
                    )}
                    {renderBackupStatusButton("Scheduled server backup", backupStatus.server)}
                    {renderSecretStatusButton()}
                  </div>
                </TooltipProvider>
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="local" className="mt-5 space-y-5">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Upload &amp; restore database backup (.rbk)
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Step 1: authorize with the Upload password. Step 2: select the encrypted .rbk
                  file, enter its encryption password, and restore it.
                </p>
              </div>
              <div className="mb-4 grid min-w-0 grid-cols-1 items-end gap-4 2xl:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">Upload password</span>
                  <PasswordInput
                    value={restoreAuthorizationInput}
                    onChange={(event) => {
                      setRestoreAuthorizationInput(event.target.value);
                      setRestoreAuthorized(false);
                    }}
                    placeholder="Enter the configured Upload password"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void authorizeRestore()}
                  disabled={Boolean(busy) || restoreAuthorizationInput.length < 8}
                  className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Lock className="size-4" />
                  {busy === "authorizeRestore" ? "Checking..." : "Authorize restore"}
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-1 items-end gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  ref={backupFileInputRef}
                  type="file"
                  accept=".rbk,application/json"
                  onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => backupFileInputRef.current?.click()}
                    disabled={Boolean(busy) || !restoreAuthorized}
                    className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-center text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                  >
                    <Upload className="size-4" />
                    Select database backup (.rbk)
                  </button>
                  <span className="min-w-0 flex-1 break-words text-xs leading-5 text-muted-foreground">
                    {restoreFile?.name ?? "No database backup selected"}
                  </span>
                </div>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">
                    Database backup encryption password
                  </span>
                  <PasswordInput
                    value={backupFilePassword}
                    onChange={(event) => setBackupFilePassword(event.target.value)}
                    placeholder="Password used to encrypt this .rbk file"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void restoreBackup()}
                  disabled={Boolean(busy) || !restoreFile || !restoreAuthorized}
                  className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Upload className="size-4" />
                  {busy === "restore" ? "Restoring..." : "Restore database backup"}
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                The database restore does not require a secret file. If secret files are not
                restored, the server keeps its existing files; on a newly rebuilt server, the
                administrator must provide whatever environment secrets are needed before starting
                the application.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="full" className="mt-5 space-y-5">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Upload &amp; restore full recovery package (.rkdr)
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Step 1: authorize with the Upload password. Step 2: select the encrypted .rkdr
                  file, enter its encryption password, and restore it.
                </p>
              </div>
              <div className="mb-4 grid min-w-0 grid-cols-1 items-end gap-4 2xl:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">Upload password</span>
                  <PasswordInput
                    value={restoreAuthorizationInput}
                    onChange={(event) => {
                      setRestoreAuthorizationInput(event.target.value);
                      setRestoreAuthorized(false);
                    }}
                    placeholder="Enter the configured Upload password"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void authorizeRestore()}
                  disabled={Boolean(busy) || restoreAuthorizationInput.length < 8}
                  className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Lock className="size-4" />
                  {busy === "authorizeRestore" ? "Checking..." : "Authorize restore"}
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-1 items-end gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <input
                  ref={fullRestoreFileInputRef}
                  type="file"
                  accept=".rkdr,application/octet-stream"
                  onChange={(event) => setFullRestoreFile(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fullRestoreFileInputRef.current?.click()}
                    disabled={Boolean(busy) || !restoreAuthorized}
                    className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-center text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                  >
                    <Upload className="size-4" />
                    Select full recovery package (.rkdr)
                  </button>
                  <span className="min-w-0 flex-1 break-words text-xs leading-5 text-muted-foreground">
                    {fullRestoreFile?.name ?? "No full recovery package selected"}
                  </span>
                </div>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium">
                    Full recovery package encryption password
                  </span>
                  <PasswordInput
                    value={fullRestoreFilePassword}
                    onChange={(event) => setFullRestoreFilePassword(event.target.value)}
                    placeholder="Password used for the .rkdr file"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void restoreFullRecoveryPackage()}
                  disabled={Boolean(busy) || !fullRestoreFile || !restoreAuthorized}
                  className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Upload className="size-4" />
                  {busy === "fullRestore" ? "Restoring..." : "Restore full recovery package"}
                </button>
                <label className="col-span-full flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={restoreDeploymentFiles}
                    onChange={(event) => setRestoreDeploymentFiles(event.target.checked)}
                    disabled={Boolean(busy) || !restoreAuthorized}
                    className="mt-1 size-4 rounded border-input"
                  />
                  <span>
                    Also restore configured deployment files and secrets. This is optional, may
                    require server permissions, and requires a backend restart before the restored
                    values take effect.
                  </span>
                </label>
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                The Full recovery package is encrypted with the same Backup encryption password and
                includes the database backup, PostgreSQL dump, roles/globals, configured external
                files, and deployment files. Actual deployment secrets are included only when the
                server administrator explicitly configures them for this feature; otherwise transfer
                them separately through a secure secret-management process.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="backup" className="mt-5 space-y-5">
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-5 shadow-sm">
              <div className="space-y-5">
                {scheduleDraft ? (
                  <div className="rounded-lg border border-border bg-background/60 p-5 shadow-sm">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Schedule and retention</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Choose when the server creates packages and how many recent packages it
                          keeps.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={scheduleDraft.enabled}
                        onClick={() =>
                          updateScheduleDraft((current) =>
                            current ? { ...current, enabled: !current.enabled } : current,
                          )
                        }
                        className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
                          scheduleDraft.enabled
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground"
                        }`}
                      >
                        <span className="relative inline-flex h-4 w-7 rounded-full bg-current/25">
                          <span
                            className={`absolute top-0.5 size-3 rounded-full bg-current transition-transform ${
                              scheduleDraft.enabled ? "translate-x-3.5" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                        {scheduleDraft.enabled ? "On" : "Off"}
                      </button>
                    </div>
                    <div
                      className="grid min-w-0 gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
                    >
                      <label className="block text-xs font-medium">
                        Frequency
                        <select
                          value={scheduleDraft.frequency}
                          onChange={(event) =>
                            updateScheduleDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    frequency: event.target.value as "daily" | "weekly",
                                  }
                                : current,
                            )
                          }
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </label>
                      {scheduleDraft.frequency === "weekly" ? (
                        <label className="block text-xs font-medium">
                          Day
                          <select
                            value={scheduleDraft.dayOfWeek}
                            onChange={(event) =>
                              updateScheduleDraft((current) =>
                                current
                                  ? { ...current, dayOfWeek: Number(event.target.value) }
                                  : current,
                              )
                            }
                            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                          >
                            {backupScheduleDayOptions.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="block text-xs font-medium">
                        Time ({scheduleDraft.timezone})
                        <ClearableInput
                          type="time"
                          value={scheduleDraft.timeOfDay}
                          onChange={(event) =>
                            updateScheduleDraft((current) =>
                              current ? { ...current, timeOfDay: event.target.value } : current,
                            )
                          }
                          onClear={() =>
                            updateScheduleDraft((current) =>
                              current ? { ...current, timeOfDay: "" } : current,
                            )
                          }
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center gap-1">
                                Retain packages
                                <Info className="size-3.5 text-muted-foreground" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="start"
                              className="max-w-xs border border-border bg-background text-foreground shadow-lg"
                            >
                              Number of recent server backup packages to keep. Older packages are
                              removed during retention cleanup.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={scheduleDraft.retentionCount}
                          onChange={(event) =>
                            updateScheduleDraft((current) =>
                              current
                                ? { ...current, retentionCount: Number(event.target.value) }
                                : current,
                            )
                          }
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        />
                      </label>
                      <label className="block text-xs font-medium sm:col-span-2 lg:col-span-1">
                        Server destination directory
                        <ClearableInput
                          type="text"
                          value={scheduleDraft.destinationDir}
                          onChange={(event) =>
                            updateScheduleDraft((current) =>
                              current
                                ? { ...current, destinationDir: event.target.value }
                                : current,
                            )
                          }
                          onClear={() =>
                            updateScheduleDraft((current) =>
                              current ? { ...current, destinationDir: "" } : current,
                            )
                          }
                          placeholder="/opt/recordkeeper/backups"
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        />
                      </label>
                      <div className="flex min-w-0 flex-wrap items-center gap-3 self-end">
                        <button
                          type="button"
                          onClick={() => void saveBackupSchedule()}
                          disabled={Boolean(busy) || !scheduleDraft}
                          className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 whitespace-normal rounded-md border border-primary/30 bg-primary px-3 text-center text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                          <Save className="size-4" />
                          {busy === "schedule" ? "Saving..." : "Save schedule"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runScheduledBackupNow()}
                          disabled={Boolean(busy) || !schedule?.schedulePasswordConfigured}
                          className="inline-flex h-9 min-w-0 max-w-full items-center justify-center gap-2 whitespace-normal rounded-md border border-border bg-background px-3 text-center text-sm font-medium disabled:opacity-50"
                        >
                          <DatabaseBackup className="size-4" />
                          {busy === "scheduleRun" ? "Creating..." : "Run backup now"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 rounded-md border border-indigo-500/25 bg-indigo-500/5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs leading-5 text-muted-foreground">
                          Deployment files and explicitly configured deployment secrets are included
                          according to the server environment settings. Scheduled packages are
                          encrypted with{" "}
                          <code className="rounded bg-background/70 px-1 py-0.5 text-foreground">
                            RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD
                          </code>
                          . The Server Administrator configures this password outside the
                          application; it is never shown here. Application Administrators can
                          enable, schedule, and run backups, but cannot view or change this
                          password. If it is not configured, scheduled backups cannot run.
                        </p>
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="img"
                                aria-label="How to configure the scheduled backup password"
                                className="inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full text-indigo-700 transition hover:bg-indigo-500/10 dark:text-indigo-300"
                              >
                                <Info className="size-4" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="end"
                              className="max-w-[min(32rem,calc(100vw-2rem))] border border-indigo-500/30 bg-background p-3 text-foreground shadow-lg"
                            >
                              <div className="space-y-2 text-xs leading-5">
                                <p className="font-semibold">Server Administrator procedure</p>
                                <ol className="list-decimal space-y-1 pl-4">
                                  <li>
                                    Generate a strong, unique password for scheduled backup
                                    encryption.
                                  </li>
                                  <li>
                                    Set <code>RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD</code> in the
                                    server backend environment or approved secret manager.
                                  </li>
                                  <li>
                                    Restart the backend service so it loads the new environment
                                    value.
                                  </li>
                                  <li>
                                    Refresh this page and run a test scheduled backup to confirm the
                                    configuration.
                                  </li>
                                </ol>
                                <p className="text-muted-foreground">
                                  Do not enter this password in the browser, commit it to source
                                  control, or share it with Application Administrators.
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    {scheduleMessage ? (
                      <p className="mt-3 text-xs text-muted-foreground" role="status">
                        {scheduleMessage}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-background/60 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground">Loading backup schedule…</p>
                  </div>
                )}

                {schedule ? (
                  <div className="rounded-lg border border-border bg-background/60 p-5 shadow-sm">
                    <h3 className="mb-4 text-sm font-semibold">Scheduled server backup details</h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <button
                        type="button"
                        onClick={() =>
                          setStatusMessage(
                            `Scheduled backup encryption password: ${schedule.schedulePasswordConfigured ? "Configured" : "Not configured"}.`,
                          )
                        }
                        className={`rounded-md px-3 py-2 text-left text-sm transition hover:brightness-95 dark:hover:brightness-110 ${
                          schedule.schedulePasswordConfigured
                            ? "bg-emerald-500/10 text-foreground"
                            : "bg-red-500/10 text-foreground"
                        }`}
                      >
                        <span className="block text-xs font-medium uppercase tracking-wide">
                          Encryption password
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                          {schedule.schedulePasswordConfigured ? "Configured" : "Not configured"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setStatusMessage(
                            `Next scheduled server backup: ${formatBackupScheduleDate(schedule.nextRunAt, schedule.timezone)}.`,
                          )
                        }
                        className={`rounded-md px-3 py-2 text-left text-sm transition hover:brightness-95 dark:hover:brightness-110 ${
                          schedule.nextRunAt
                            ? "bg-emerald-500/10 text-foreground"
                            : "bg-red-500/10 text-foreground"
                        }`}
                      >
                        <span className="block text-xs font-medium uppercase tracking-wide">
                          Next run
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                          {formatBackupScheduleDate(schedule.nextRunAt, schedule.timezone)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setStatusMessage(
                            `Last scheduled server backup status: ${schedule.lastStatus}.`,
                          )
                        }
                        className={`rounded-md px-3 py-2 text-left text-sm transition hover:brightness-95 dark:hover:brightness-110 ${
                          schedule.lastStatus === "success"
                            ? "bg-emerald-500/10 text-foreground"
                            : "bg-red-500/10 text-foreground"
                        }`}
                      >
                        <span className="block text-xs font-medium uppercase tracking-wide">
                          Last status
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                          {schedule.lastStatus}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setStatusMessage(
                            `Last scheduled server backup file: ${schedule.lastFileName ?? "None"}.`,
                          )
                        }
                        className={`rounded-md px-3 py-2 text-left text-sm transition hover:brightness-95 dark:hover:brightness-110 ${
                          schedule.lastFileName
                            ? "bg-emerald-500/10 text-foreground"
                            : "bg-red-500/10 text-foreground"
                        }`}
                      >
                        <span className="block text-xs font-medium uppercase tracking-wide">
                          Last file
                        </span>
                        <span className="mt-1 block truncate text-sm font-semibold">
                          {schedule.lastFileName ?? "None"}
                        </span>
                      </button>
                    </div>
                    {schedule.lastError ? (
                      <p
                        className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
                        role="alert"
                      >
                        Last error: {schedule.lastError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </TabsContent>
        </fieldset>
      </Tabs>
      {statusMessage ? (
        <p
          className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-foreground"
          role="status"
        >
          {statusMessage}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function useSettingsUsageFiles() {
  const fallbackFiles = useFiles();
  const [usageFiles, setUsageFiles] = useState<FileRecord[]>(() => fallbackFiles);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const loadUsageFiles = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [activePayload, archivedPayload] = await Promise.all([
          fetchFilesForYear(""),
          store.listArchivedFiles(),
        ]);
        if (!cancelled) {
          const byId = new Map<string, FileRecord>();
          [...activePayload.files, ...archivedPayload.files].forEach((file) =>
            byId.set(file.id, file),
          );
          setUsageFiles(Array.from(byId.values()));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) setUsageFiles(fallbackFiles);
      } finally {
        inFlight = false;
      }
    };

    void loadUsageFiles();
    window.addEventListener("focus", loadUsageFiles);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadUsageFiles);
    };
  }, [fallbackFiles]);

  return usageFiles;
}

function YearSetupSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  return (
    <YearSetupPanel
      settingsOverride={settings}
      onSetupYearChange={(setupYear) => updateSettings({ setupYear })}
    />
  );
}

function SettingsPage() {
  const activeUser = useActiveUser();
  const settingsRole: AppUserRole | undefined = activeUser?.role;
  const locationSearch = useRouterState({ select: (state) => state.location.search });
  const [activeAdminSection, setActiveAdminSection] = useState("theme");
  const [unlockedAdminSections, setUnlockedAdminSections] = useState<Record<string, boolean>>({});
  const [hasUnsavedAdminChanges, setHasUnsavedAdminChanges] = useState(false);
  useUnsavedChanges("settings-admin-sections", hasUnsavedAdminChanges);
  const [settingsSidePanelHooked, setSettingsSidePanelHooked] = useState(true);
  const [expandedAdminGroup, setExpandedAdminGroup] = useState("personal");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [viewerSettingsTab, setViewerSettingsTab] = useState("theme");
  const [teamSettingsTab, setTeamSettingsTab] = useState("user");

  useEffect(() => {
    const requestedSection =
      typeof locationSearch.section === "string" ? locationSearch.section : undefined;
    if (requestedSection && adminSectionKeys.has(requestedSection)) {
      setActiveAdminSection(requestedSection);
    }
  }, [locationSearch.section]);

  if (activeUser?.role === "viewer" || activeUser?.role === "division_user") {
    return (
      <div className="settings-page max-w-6xl space-y-5">
        <Tabs
          value={viewerSettingsTab}
          onValueChange={async (value) => {
            if (
              hasAnyUnsavedChanges() &&
              !(await showAppConfirm("You have unsaved changes. Leave this section without saving?"))
            ) {
              return;
            }
            setViewerSettingsTab(value);
          }}
          className="space-y-5"
        >
          <TabsList
            aria-label="Settings sections"
            className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-border bg-secondary/20 p-1"
          >
            <SettingsTabTrigger value="theme" label="UI theme" helperKey="theme" />
            <SettingsTabTrigger value="noticeBoard" label="Notice board" helperKey="noticeBoard" />
            <SettingsTabTrigger value="indentors" label="Indentors" helperKey="indentors" />
            <SettingsTabTrigger value="presets" label="Preset table fields" helperKey="presets" />
          </TabsList>
          <TabsContent value="theme">
            <UserSettingsDraft showScope={false} actionPlacement="inside">
              <PreferenceSettings readOnly={activeUser?.role === "viewer"} />
            </UserSettingsDraft>
          </TabsContent>
          <TabsContent value="noticeBoard">
            <QuickAccessSettings
              section="noticeBoard"
              readOnly={activeUser?.role === "viewer"}
            />
          </TabsContent>
          <TabsContent value="indentors">
            <SettingsScope scope="shared" editors="Administrators and Sub-admins" />
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="presets">
            <UserSettingsDraft>
              <TableFieldPresetSettings />
            </UserSettingsDraft>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  if (activeUser?.role === "sub_admin" || activeUser?.role === "editor") {
    const canEditMmgSummary = false;
    return (
      <div className="settings-page max-w-6xl space-y-5">
        <Tabs
          value={teamSettingsTab}
          onValueChange={async (value) => {
            if (
              hasAnyUnsavedChanges() &&
              !(await showAppConfirm("You have unsaved changes. Leave this section without saving?"))
            ) {
              return;
            }
            setTeamSettingsTab(value);
          }}
          className="space-y-5"
        >
          <TabsList
            aria-label="Settings sections"
            className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-border bg-secondary/20 p-1"
          >
            <SettingsTabTrigger value="theme" label="UI theme" helperKey="theme" />
            <SettingsTabTrigger value="noticeBoard" label="Notice board" helperKey="noticeBoard" />
            <SettingsTabTrigger value="user" label="User" helperKey="user" />
            <SettingsTabTrigger value="indentors" label="Indentors" helperKey="indentors" />
            <SettingsTabTrigger value="firms" label="Firm Database" helperKey="firms" />
            <SettingsTabTrigger value="presets" label="Preset table fields" helperKey="presets" />
            {activeUser?.role === "sub_admin" ? (
              <SettingsTabTrigger value="archive" label="Archive" helperKey="archiveSubAdmin" />
            ) : null}
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
          <TabsContent value="theme">
            <UserSettingsDraft showScope={false} actionPlacement="inside">
              <PreferenceSettings />
            </UserSettingsDraft>
          </TabsContent>
          <TabsContent value="noticeBoard">
            <QuickAccessSettings section="noticeBoard" />
          </TabsContent>
          <TabsContent value="user">
            <UserSettingsDraft>
              <AccountSettings />
            </UserSettingsDraft>
          </TabsContent>
          <TabsContent value="indentors">
            <SettingsScope scope="shared" editors="Administrators and Sub-admins" />
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="firms">
            <SettingsScope
              scope="shared"
              editors="Administrators, Sub-admins, and Editors (firm records); Administrators and Sub-admins (types and deletion)"
            />
            <FirmDatabaseSettings />
          </TabsContent>
          <TabsContent value="presets">
            <UserSettingsDraft>
              <TableFieldPresetSettings />
            </UserSettingsDraft>
          </TabsContent>
          {activeUser?.role === "sub_admin" ? (
            <TabsContent value="archive">
              <ArchiveSettings />
            </TabsContent>
          ) : null}
          {canEditMmgSummary ? (
            <TabsContent value="anomalyGovernance">
              <SettingsScope scope="shared" editors="Administrators and Sub-admins" />
              <AnomalyGovernanceSettings />
            </TabsContent>
          ) : null}
          {canEditMmgSummary ? (
            <TabsContent value="mmgSummary">
              <UserSettingsDraft scope="shared" editors="Administrators and Sub-admins">
                <MmgSummarySettings />
              </UserSettingsDraft>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    );
  }

  if (!canViewAdminSettings(activeUser?.role)) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Admin settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is available only to administrators.
        </p>
      </div>
    );
  }

  const allAdminSections: AdminSection[] = [
    {
      key: "theme",
      label: "UI theme",
      helper: settingsSectionHelpers.theme,
      content: <PreferenceSettings />,
    },
    {
      key: "noticeBoard",
      label: "Notice board",
      helper: settingsSectionHelpers.noticeBoard,
      content: <QuickAccessSettings section="noticeBoard" />,
    },
    {
      key: "quickEntryExcel",
      label: "Quick Entry Excel",
      helper: settingsSectionHelpers.quickEntryExcel,
      content: <QuickEntryExcelSettings />,
    },
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
      key: "offsetDays",
      label: "Offset days setting",
      helper: settingsSectionHelpers.offsetDays,
      content: <OffsetDaysSettings />,
    },
    {
      key: "yearSetup",
      label: "Year Setup",
      helper: settingsSectionHelpers.yearSetup,
      content: <YearSetupSettings />,
    },
    {
      key: "mmgSummary",
      label: "MMG Summary",
      helper: settingsSectionHelpers.mmgSummary,
      content: <MmgSummarySettings />,
    },
    {
      key: "demandProcessing",
      label: "Demand Processing Analysis Presets",
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
      key: "gemBiddingModes",
      label: "GeM Bidding Modes",
      helper: settingsSectionHelpers.gemBiddingModes,
      content: <GemBiddingModeSettings />,
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
      key: "bgReceiptDelay",
      label: "BG receipt delay",
      helper: settingsSectionHelpers.bgReceiptDelay,
      content: <BgReceiptDelaySettings />,
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
    {
      key: "protectedBackup",
      label: "Protected backup",
      helper: settingsSectionHelpers.protectedBackup,
      content: <ProtectedBackupSettings />,
    },
  ];
  const universalViewer = isUniversalViewer(activeUser?.role);
  const adminSections = universalViewer
    ? allAdminSections.filter((section) =>
        ["theme", "user", "presets", "offsetDays", "noticeBoard"].includes(section.key),
      )
    : settingsRole === "sub_admin"
      ? allAdminSections.filter((section) =>
          ["theme", "user", "workspace", "offsetDays"].includes(section.key),
        )
      : allAdminSections;
  const selectedAdminSection =
    adminSections.find((section) => section.key === activeAdminSection) ?? adminSections[0];
  const selectedAdminSectionUnlocked =
    Boolean(unlockedAdminSections[selectedAdminSection.key]) ||
    selectedAdminSection.key === "theme" ||
    (universalViewer && ["user", "presets", "noticeBoard"].includes(selectedAdminSection.key));
  const adminSectionGroups = [
    {
      key: "organization",
      label: "Organization",
      keys: ["workspace", "yearSetup", "divisions", "indentors"],
    },
    {
      key: "procurement",
      label: "Procurement Setup",
      keys: [
        "modes",
        "gemBiddingModes",
        "fileTypes",
        "firmTypes",
        "firms",
        "tcec",
        "fileMarkers",
        "milestones",
      ],
    },
    {
      key: "analytics",
      label: "Analytics and reports",
      keys: [
        "thresholds",
        "bgReceiptDelay",
        "offsetDays",
        "demandProcessing",
        "presets",
        "firmRating",
        "mmgSummary",
        "anomalyGovernance",
        "quickEntryExcel",
      ],
    },
    {
      key: "access",
      label: "Access and security",
      keys: ["user", "users", "ipAccess", "archive", "protectedBackup"],
    },
    {
      key: "personal",
      label: "Personal preferences",
      keys: ["theme", "noticeBoard"],
    },
  ]
    .map((group) => ({
      ...group,
      sections: group.keys
        .map((key) => adminSections.find((section) => section.key === key))
        .filter((section): section is AdminSection => Boolean(section)),
    }))
    .filter((group) => group.sections.length > 0);

  const normalizedSettingsSearch = settingsSearch.trim().toLocaleLowerCase();
  const sectionMatchesSettingsSearch = (section: AdminSection) => {
    if (!normalizedSettingsSearch) return true;
    const searchableText = [
      section.key,
      section.label,
      section.helper.join(" "),
      adminSectionSearchText[section.key] ?? "",
      (adminSectionControlLabels[section.key] ?? []).join(" "),
      section.searchText ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchableText.includes(normalizedSettingsSearch);
  };
  const visibleAdminSectionGroups = normalizedSettingsSearch
    ? adminSectionGroups
        .map((group) => ({
          ...group,
          sections: group.sections.filter(sectionMatchesSettingsSearch),
        }))
        .filter((group) => group.sections.length > 0)
    : adminSectionGroups;

  const setAdminSectionUnlocked = (key: string, unlocked: boolean) => {
    setUnlockedAdminSections((current) => ({ ...current, [key]: unlocked }));
  };

  return (
    <div className="settings-page min-w-0 max-w-none space-y-5">
      <div
        className={
          "grid min-w-0 max-w-full grid-cols-1 gap-4 " +
          (settingsSidePanelHooked
            ? "lg:grid-cols-[260px_minmax(0,1fr)]"
            : "lg:grid-cols-[48px_minmax(0,1fr)]")
        }
      >
        {settingsSidePanelHooked ? (
          <div className="min-w-0 space-y-3">
            <div className="section-accent-border rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
              <div className="space-y-1.5">
                <label
                  htmlFor="settings-free-search"
                  className="block text-xs font-semibold text-foreground"
                >
                  Find setting
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="settings-free-search"
                    type="text"
                    value={settingsSearch}
                    onChange={(event) => setSettingsSearch(event.target.value)}
                    placeholder="Type a setting name"
                    className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {settingsSearch ? (
                    <button
                      type="button"
                      onClick={() => setSettingsSearch("")}
                      className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Clear Settings search"
                      title="Clear Settings search"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              {normalizedSettingsSearch ? (
                <p className="mt-2 text-xs font-light text-muted-foreground">
                  {visibleAdminSectionGroups.reduce((count, group) => count + group.sections.length, 0)}{" "}
                  matching Settings section(s). Matching left-panel buttons are highlighted.
                </p>
              ) : null}
            </div>
            <aside className="rounded-xl border border-border bg-secondary/35 p-3 shadow-[var(--shadow-card)]">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Settings
              </div>
              <button
                type="button"
                onClick={() => setSettingsSidePanelHooked(false)}
                className="rounded-md border border-border bg-background px-2 py-1 text-[0.6875rem] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Unhook side panel"
              >
                Unhook
              </button>
            </div>
            <div className="max-h-[calc(100vh-12rem)] space-y-2 overflow-y-auto pr-1">
              {visibleAdminSectionGroups.map((group) => (
                <section
                  key={group.key}
                  className={
                    "overflow-hidden rounded-md border " +
                    settingsGroupAccentClasses[settingsAccentByGroup[group.key] ?? "sky"]
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (normalizedSettingsSearch) return;
                      setExpandedAdminGroup((current) => (current === group.key ? "" : group.key));
                    }}
                    aria-expanded={
                      normalizedSettingsSearch ? true : expandedAdminGroup === group.key
                    }
                      className={
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition " +
                      (group.sections.some((section) => section.key === selectedAdminSection.key)
                        ? settingsGroupHeaderAccentClasses[
                            settingsAccentByGroup[group.key] ?? "sky"
                          ]
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground")
                    }
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={
                        "size-4 transition-transform " +
                        (expandedAdminGroup === group.key ? "rotate-180" : "")
                      }
                      aria-hidden="true"
                    />
                  </button>
                  {normalizedSettingsSearch || expandedAdminGroup === group.key ? (
                    <div className="space-y-1 border-t border-border bg-secondary/20 p-1.5">
                      {group.sections.map((section) => {
                        const selected = selectedAdminSection.key === section.key;
                        const matchesSearch = sectionMatchesSettingsSearch(section);
                        return (
                          <div key={section.key} className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  section.key !== activeAdminSection &&
                                  (hasUnsavedAdminChanges || hasAnyUnsavedChanges()) &&
                                  !(await showAppConfirm(
                                    "Discard unsaved settings changes and switch sections?",
                                  ))
                                )
                                  return;
                                if (section.key === activeAdminSection) return;
                                setHasUnsavedAdminChanges(false);
                                setActiveAdminSection(section.key);
                              }}
                              className={
                                "min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                                (selected
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : matchesSearch && normalizedSettingsSearch
                                    ? "bg-amber-100 text-amber-950 ring-2 ring-amber-400/70 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-500/70"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                              }
                            >
                              {section.label}
                            </button>
                            <SettingsHelper
                              items={section.helper}
                              label={`${section.label} help`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ))}
              {normalizedSettingsSearch && visibleAdminSectionGroups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm font-light text-muted-foreground">
                  No matching Settings section.
                </p>
              ) : null}
            </div>
            </aside>
          </div>
        ) : (
          <aside className="rounded-xl border border-border bg-secondary/35 p-2 shadow-[var(--shadow-card)]">
            <button
              type="button"
              onClick={() => setSettingsSidePanelHooked(true)}
              className="flex h-full min-h-40 w-full items-center justify-center rounded-md border border-dashed border-border bg-background px-1 py-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Hook side panel"
              aria-label="Hook side panel"
            >
              <span className="[writing-mode:vertical-rl] rotate-180">Hook panel</span>
            </button>
          </aside>
        )}
        <div className="min-w-0">
          <LockedAdminSection
            key={selectedAdminSection.key}
            section={selectedAdminSection}
            scopeInfo={adminSettingsScope(selectedAdminSection.key, settingsRole)}
            unlocked={selectedAdminSectionUnlocked}
            onLock={() => setAdminSectionUnlocked(selectedAdminSection.key, false)}
            onUnlock={() => setAdminSectionUnlocked(selectedAdminSection.key, true)}
            onDirtyChange={setHasUnsavedAdminChanges}
            hideUnlock={universalViewer}
          />
        </div>
      </div>
    </div>
  );
}

function LockedAdminSection({
  section,
  scopeInfo,
  unlocked,
  onLock,
  onUnlock,
  onDirtyChange,
  hideUnlock = false,
}: {
  section: AdminSection;
  scopeInfo: { scope: SettingsScopeKind; editors: string };
  unlocked: boolean;
  onLock: () => void;
  onUnlock: () => void;
  onDirtyChange: (dirty: boolean) => void;
  hideUnlock?: boolean;
}) {
  // These panels own their save/cancel controls. The outer draft action would
  // otherwise imply that it can save or discard their local forms.
  const hasLocalSaveAction = new Set([
    "noticeBoard",
    "quickEntryExcel",
    "thresholds",
    "bgReceiptDelay",
    "divisions",
    "indentors",
    "users",
    "archive",
  ]).has(section.key);
  const hasInlineActionBar = section.key === "protectedBackup";
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftPatch, setDraftPatch] = useState<Partial<AppSettings>>({});
  const [externalDirty, setExternalDirty] = useState(false);
  const [localDirty, setLocalDirty] = useState(false);
  const externalDraftRef = useRef<SettingsExternalDraftHandlers | null>(null);
  const savedSettings = useStoreSettings();
  const draftSettings = { ...savedSettings, ...draftPatch };
  const hasChanges = Object.keys(draftPatch).length > 0 || externalDirty;
  const hasUnsavedChanges = hasChanges || localDirty;

  const registerExternalDraft = useCallback((handlers: SettingsExternalDraftHandlers | null) => {
    externalDraftRef.current = handlers;
  }, []);

  const updateDraftSettings = (patch: Partial<AppSettings>) => {
    setDraftPatch((current) => ({ ...current, ...patch }));
    onDirtyChange(true);
    setSaveError("");
  };

  const saveChanges = async () => {
    if (!hasChanges || saving) return;
    if (localDirty) {
      setSaveError("Finish or cancel the section's local edit before saving these settings.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      if (Object.keys(draftPatch).length > 0) {
        await store.saveSettings(draftPatch);
      }
      if (externalDirty && externalDraftRef.current) {
        await externalDraftRef.current.save();
      }
      setDraftPatch({});
      setExternalDirty(false);
      setLocalDirty(false);
      onDirtyChange(false);
      if (!hideUnlock) onLock();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const cancelChanges = async () => {
    if (
      hasUnsavedChanges &&
      !(await showAppConfirm("Discard your unsaved settings changes?"))
    )
      return;
    setDraftPatch({});
    externalDraftRef.current?.cancel();
    setExternalDirty(false);
    setLocalDirty(false);
    onDirtyChange(false);
    setSaveError("");
    if (!hideUnlock) onLock();
  };

  const unlock = async () => {
    const password = await promptPassword(`Enter admin password to edit ${section.label}:`);
    if (password === null) return;
    if (!password.trim()) {
      await showAppAlert("Password is required.");
      return;
    }
    setVerifying(true);
    try {
      await store.verifyAdminPassword(password);
      setDraftPatch({});
      externalDraftRef.current?.cancel();
      setExternalDirty(false);
      setLocalDirty(false);
      onDirtyChange(false);
      setSaveError("");
      onUnlock();
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : "Incorrect password.");
    } finally {
      setVerifying(false);
    }
  };

  const hasOuterScope = !["theme", "noticeBoard", "offsetDays"].includes(section.key);
  const sectionAccent = settingsAccentForSection(section.key);

  return (
    <div
      className={
        hasOuterScope
          ? "settings-panel min-w-0 max-w-full overflow-hidden rounded-lg border border-border shadow-sm " +
            settingsPanelAccentClasses[sectionAccent]
          : "settings-panel min-w-0 max-w-full space-y-0 " + settingsPanelAccentClasses[sectionAccent]
      }
    >
      {section.key !== "theme" && !hasInlineActionBar ? (
        <div
          className={
            "flex min-h-10 flex-wrap items-center justify-between gap-3 " +
            (hasOuterScope ? "px-5 py-3" : "")
          }
        >
          <div className="min-w-0">
            {hasOuterScope && !hasInlineActionBar ? <SettingsScope {...scopeInfo} /> : null}
            {saveError ? (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {saveError}
              </p>
            ) : null}
          </div>
          {unlocked ? (
            hasLocalSaveAction ? (
              !hideUnlock ? (
                <button
                  type="button"
                  onClick={cancelChanges}
                  disabled={saving}
                  className="h-9 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  <Lock className="size-3.5" /> Lock section
                </button>
              ) : null
            ) : (
              <div className="flex shrink-0 items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelChanges}
                  disabled={saving || (!hasUnsavedChanges && hideUnlock)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveChanges()}
                  disabled={!hasChanges || saving}
                  className="h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Save className="size-4" /> {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            )
          ) : !hideUnlock ? (
            <button
              type="button"
              onClick={() => void unlock()}
              disabled={verifying || saving}
              className={
                "h-8 shrink-0 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium disabled:cursor-wait disabled:opacity-60 " +
                (unlocked
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                  : "border-border bg-background hover:bg-accent")
              }
            >
              <Lock className="size-3.5" /> Edit
            </button>
          ) : null}
        </div>
      ) : null}
      {hasInlineActionBar ? (
        <SettingsDraftContext.Provider
          value={{
            settings: draftSettings,
            updateSettings: updateDraftSettings,
            actions: unlocked
              ? { hasChanges, hasUnsavedChanges, saving, saveError, cancelChanges, saveChanges }
              : undefined,
            sectionUnlocked: unlocked,
            sectionSaving: saving,
            sectionVerifying: verifying,
            unlockSection: () => void unlock(),
            setExternalDirty: (dirty) => {
              setExternalDirty(dirty);
              onDirtyChange(Object.keys(draftPatch).length > 0 || dirty || localDirty);
            },
            setLocalDirty: (dirty) => {
              setLocalDirty(dirty);
              onDirtyChange(Object.keys(draftPatch).length > 0 || externalDirty || dirty);
            },
            registerExternalDraft,
          }}
        >
          <div className="settings-content-inset min-w-0 max-w-full px-3">{section.content}</div>
        </SettingsDraftContext.Provider>
      ) : (
        <fieldset
          disabled={!unlocked || saving}
          className={
            "settings-content-inset min-w-0 max-w-full px-3 text-sm text-foreground " +
            (!unlocked ? "pointer-events-none opacity-70 [&_*]:cursor-not-allowed" : "")
          }
        >
          <SettingsDraftContext.Provider
            value={{
              settings: draftSettings,
              updateSettings: updateDraftSettings,
              actions: unlocked
                ? { hasChanges, hasUnsavedChanges, saving, saveError, cancelChanges, saveChanges }
                : undefined,
              setExternalDirty: (dirty) => {
                setExternalDirty(dirty);
                onDirtyChange(Object.keys(draftPatch).length > 0 || dirty || localDirty);
              },
              setLocalDirty: (dirty) => {
                setLocalDirty(dirty);
                onDirtyChange(Object.keys(draftPatch).length > 0 || externalDirty || dirty);
              },
              registerExternalDraft,
            }}
          >
            {section.content}
          </SettingsDraftContext.Provider>
        </fieldset>
      )}
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
    <span className="inline-flex min-w-[12rem] flex-[1_1_14rem] items-center gap-1">
      <TabsTrigger
        value={value}
        className="min-h-10 min-w-0 flex-1 justify-start rounded-md px-3 py-2 text-left text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
      >
        {label}
      </TabsTrigger>
      <SettingsHelper
        items={settingsSectionHelpers[helperKey]}
        label={`${label} help`}
        sectionOrder={helperKey === "milestones" ? milestoneHelperSectionOrder : undefined}
      />
    </span>
  );
}

function SettingsHelper({
  items,
  label,
  sectionOrder,
}: {
  items: string[];
  label: string;
  sectionOrder?: string[];
}) {
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
        <TooltipContent
          side="right"
          align="start"
          className="w-fit max-w-[min(56rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
        >
          <HelperContent lines={bullets} sectionOrder={sectionOrder} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function AuthorisedUserRolesTooltip() {
  const contentRef = useRef<HTMLDivElement>(null);
  const rows = [
    {
      role: "Admin",
      can: "Manage all divisions, records, users, shared settings, and security.",
      limits:
        "Protected actions may still require the signed-in Admin's personal deletion password.",
    },
    {
      role: "Sub-admin",
      can: "Work within assigned divisions; edit records and settings enabled for this role.",
      limits:
        "Cannot access unassigned divisions, manage user accounts, or manage IP security settings.",
    },
    {
      role: "Editor",
      can: "Create and edit records in assigned divisions and permitted file categories.",
      limits: "Cannot manage user accounts or admin settings.",
    },
    {
      role: "Viewer",
      can: "Division viewer login using that division's viewer password; access is limited to exactly one division.",
      limits:
        "Read-only for file records. Can submit a file query/message, but cannot resolve or reply. This is not a named authorised-user account.",
    },
    {
      role: "Division user",
      can: "Named authorised account with its own login and one or more explicitly assigned divisions.",
      limits:
        "Read-only for file records. Can submit a file query/message, but cannot resolve or reply; access is denied when no division is assigned.",
    },
    {
      role: "Universal Viewer",
      can: "View assigned divisions and add file-status notes. Cash Out Go scope can be view-only, personal, or global with MER.",
      limits:
        "Cannot edit core file records. Access is limited to assigned divisions; no assigned division means no records. Global Cash Out Go/MER edits affect everyone.",
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Authorised user role permissions"
            onClick={(event) => event.preventDefault()}
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
          >
            <Info className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          className="w-fit max-w-[min(56rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg"
        >
          <div className="mb-1 flex justify-end">
            <HelperPdfButton
              contentRef={contentRef}
              breadcrumb={["Settings", "Authorised users", "Role permissions"]}
            />
          </div>
          <div ref={contentRef} className="max-h-[min(70vh,36rem)] overflow-auto">
            <table className="min-w-[38rem] border-collapse text-left text-xs leading-relaxed">
              <caption className="mb-2 text-left text-sm font-semibold text-foreground">
                Role permissions
              </caption>
              <thead>
                <tr className="border-b border-border bg-secondary/60 text-muted-foreground">
                  <th scope="col" className="w-28 px-2 py-1.5 font-semibold">
                    Role
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">
                    Can do
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">
                    Cannot do / limits
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.role} className="border-b border-border last:border-0">
                    <th scope="row" className="px-2 py-1.5 align-top font-semibold text-foreground">
                      {row.role}
                    </th>
                    <td className="px-2 py-1.5 align-top text-popover-foreground">{row.can}</td>
                    <td className="px-2 py-1.5 align-top text-popover-foreground">{row.limits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 max-w-[38rem] text-[0.6875rem] text-muted-foreground">
              Admin can access all divisions. Universal Viewer, Sub-admin, Editor, Viewer, and
              Division user access is limited to assigned divisions; file-category limits apply to
              Editors.
            </p>
          </div>
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

type SettingsCashOutGoPlan = {
  settings: {
    billOffsetDays: number;
    defaultBillOffsetDays: number;
    useCustomBillOffsetDays: boolean;
    handSubmissionOffsetDays: number;
    defaultHandSubmissionOffsetDays: number;
    useCustomHandSubmissionOffsetDays: boolean;
    dpOffsetDays: number;
    defaultDpOffsetDays: number;
    useCustomDpOffsetDays: boolean;
  };
};

function CashOutGoOffsetSettings({ canEdit, scopeNote }: { canEdit: boolean; scopeNote: string }) {
  const draft = useContext(SettingsDraftContext);
  const settings = useSettings();
  const activeUser = useActiveUser();
  const personalScope =
    activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal";
  const cashOutGoEditors = personalScope
    ? "You"
    : activeUser?.role === "universal_viewer"
      ? "Administrators, Sub-admins, and authorized Universal Viewers"
      : "Administrators and Sub-admins";
  const [plan, setPlan] = useState<SettingsCashOutGoPlan | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initialPlanRef = useRef<SettingsCashOutGoPlan | undefined>(undefined);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    const query = new URLSearchParams({
      financialYear: settings.financialYear,
      includePreviousFySubmitted: "false",
      divisionId: "all",
    });
    fetch(`${apiBase}/api/reports/cash-out-go-plan?${query}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cash Out Go offsets could not be loaded.");
        const body = (await response.json()) as { plan?: SettingsCashOutGoPlan };
        setPlan(body.plan);
        initialPlanRef.current = body.plan;
        setDirty(false);
        setSaved(false);
        setError("");
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Offsets could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [settings.financialYear]);

  const updateOffset = (
    key: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
    value: string,
  ) => {
    if (!plan) return;
    const defaultDays =
      key === "dpOffsetDays"
        ? plan.settings.defaultDpOffsetDays
        : key === "billOffsetDays"
          ? plan.settings.defaultBillOffsetDays
          : plan.settings.defaultHandSubmissionOffsetDays;
    const isPersonalScope =
      activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal";
    const enabledKey =
      key === "dpOffsetDays"
        ? "useCustomDpOffsetDays"
        : key === "billOffsetDays"
          ? "useCustomBillOffsetDays"
          : "useCustomHandSubmissionOffsetDays";
    const days = Math.max(0, Number.parseInt(value || "0", 10) || 0);
    setPlan({
      ...plan,
      settings: {
        ...plan.settings,
        [key]: days,
        [enabledKey]: isPersonalScope ? days !== defaultDays : true,
      },
    });
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    if (!plan || !canEdit) return;
    setSaving(true);
    setError("");
    const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    try {
      const response = await fetch(`${apiBase}/api/reports/cash-out-go-plan`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.settings),
      });
      if (!response.ok) throw new Error("Cash Out Go offsets could not be saved.");
      initialPlanRef.current = plan;
      setDirty(false);
      setSaved(true);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Offsets could not be saved.";
      setError(message);
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  saveRef.current = save;
  cancelRef.current = () => {
    setPlan(initialPlanRef.current);
    setDirty(false);
    setSaved(false);
    setError("");
  };

  useEffect(() => {
    if (!canEdit || !draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: () => saveRef.current(),
      cancel: () => cancelRef.current(),
    });
    return () => draft.registerExternalDraft?.(null);
  }, [canEdit, draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setExternalDirty?.(canEdit && dirty);
  }, [canEdit, dirty, draft?.setExternalDirty]);

  const parentOwnsSave = Boolean(canEdit && draft?.actions);

  const cashSettings = plan?.settings;
  const fields = [
    {
      key: "dpOffsetDays" as const,
      label: "D.P. / revised D.P. to expected cash-out date",
      value: cashSettings?.dpOffsetDays ?? 10,
      helper: [
        "Reports → Cash Out Go Plan → D.P.-based forecast.",
        "Reports → Expected Cash Outgo by D.P.",
        "The plan adds one day before this offset.",
      ],
    },
    {
      key: "handSubmissionOffsetDays" as const,
      label: "Bill preparation to expected submission / resubmission",
      value: cashSettings?.handSubmissionOffsetDays ?? 5,
      helper: [
        "Reports → Cash Out Go Plan → Bills at Hand.",
        "Sets the expected interval from the row's forecast base date to sending or resubmitting the bill.",
      ],
    },
    {
      key: "billOffsetDays" as const,
      label: "Bill sent / resubmitted to expected payment",
      value: cashSettings?.billOffsetDays ?? 5,
      helper: [
        "Reports → Cash Out Go Plan → expected payment date.",
        "A row-specific payment-offset override takes precedence when present.",
      ],
    },
  ];

  return (
    <div className="mt-4 rounded-md border border-border bg-background p-4">
      <h4 className="text-sm font-semibold">Cash Out Go forecast offsets</h4>
      <div className="mb-2 mt-1">
        <SettingsScope scope={personalScope ? "personal" : "shared"} editors={cashOutGoEditors} />
      </div>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        {scopeNote}{" "}
        {parentOwnsSave
          ? "Use the section Save changes action above to keep changes for future visits."
          : "Save shared offsets to keep changes for future visits."}{" "}
        They remain in effect until changed and saved again. Row-specific overrides remain separate
        where the report allows them.
      </p>
      {loading ? <p className="text-xs text-muted-foreground">Loading shared offsets...</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className="block rounded-md border border-border p-3">
            <span className="mb-1 block text-xs font-medium">{field.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={field.value}
                disabled={!canEdit || loading || !plan}
                onChange={(event) => updateOffset(field.key, event.target.value)}
                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              />
              <span className="text-xs text-muted-foreground">days</span>
            </span>
            <span className="mt-2 block space-y-1 text-xs leading-relaxed text-muted-foreground">
              {field.helper.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
      {canEdit && parentOwnsSave ? null : canEdit ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {error ? (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void save().catch(() => undefined)}
            disabled={!plan || loading || saving || saved}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saved ? <Check className="size-4" /> : <Save className="size-4" />}
            {saving ? "Saving..." : saved ? "Saved" : "Save shared offsets"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          These values are view-only for this role; shared Cash Out Go offsets cannot be changed
          here.
        </p>
      )}
    </div>
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

function PreferenceSettings({ readOnly = false }: { readOnly?: boolean }) {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  return (
    <fieldset disabled={readOnly} className="space-y-5">
      {readOnly ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-foreground">
          Display preferences are read-only for division-password viewers and are not saved for
          this account type.
        </p>
      ) : null}
      <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold mb-1">UI theme</h2>
            <SettingsScope scope="personal" editors="You" />
          </div>
          <SettingsDraftActionBarFromContext />
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Sets this account's display theme, optional ribbon styling, and font.
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <AppearancePresetField
            value={settings.appearancePreset}
            onChange={(preset) => {
              const selected = appearancePresetOptions.find((option) => option.value === preset);
              updateSettings(
                selected
                  ? {
                      appearancePreset: selected.value,
                      theme: selected.theme,
                      themeTint: selected.themeTint,
                      topRibbonColor: selected.topRibbonColor,
                      topRibbonTextColor: selected.topRibbonTextColor,
                      fontFamily: selected.fontFamily,
                    }
                  : {
                      appearancePreset: null,
                      topRibbonColor: null,
                      topRibbonTextColor: null,
                      fontFamily: null,
                    },
              );
            }}
          />
          <ThemeField
            label="Theme"
            value={settings.theme}
            onChange={(value) => updateSettings({ theme: value, appearancePreset: null })}
          />
          <ThemeTintField
            label="Theme color"
            value={settings.themeTint}
            onChange={(value) => updateSettings({ themeTint: value, appearancePreset: null })}
          />
          <TopRibbonColorField
            value={settings.topRibbonColor}
            onChange={(value) => updateSettings({ topRibbonColor: value, appearancePreset: null })}
          />
          <TopRibbonTextColorField
            value={settings.topRibbonTextColor}
            onChange={(value) =>
              updateSettings({ topRibbonTextColor: value, appearancePreset: null })
            }
          />
          <FontFamilyField
            value={settings.fontFamily}
            onChange={(value) => updateSettings({ fontFamily: value, appearancePreset: null })}
          />
        </div>
      </div>
      <div className="grid items-stretch grid-cols-1 gap-5 xl:grid-cols-2">
        {activeUser?.role === "admin" ? <GlobalChartColorSettings /> : null}
        <section className="h-full rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-1 text-sm font-semibold">Chart colours for your account</h2>
          <div className="mb-2">
            <SettingsScope scope="personal" editors="You" />
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Set the colour order used by your bars, columns and pie charts. It is disabled while an
            administrator's shared colour policy is enforced.
          </p>
          <ChartColorOrderField
            value={settings.chartColorOrder ?? chartColorOptions.map((option) => option.color)}
            onChange={(value) => updateSettings({ chartColorOrder: value })}
            disabled={settings.globalChartColorsEnforced === true}
          />
        </section>
      </div>
      <AddEditRibbonSettings readOnly={readOnly} />
    </fieldset>
  );
}

function GlobalChartColorSettings() {
  const settings = useSettings();
  const draftContext = useContext(SettingsDraftContext);
  const [order, setOrder] = useState(
    settings.globalChartColorOrder ?? chartColorOptions.map((option) => option.color),
  );
  const [enforced, setEnforced] = useState(settings.globalChartColorsEnforced === true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setOrder(settings.globalChartColorOrder ?? chartColorOptions.map((option) => option.color));
    setEnforced(settings.globalChartColorsEnforced === true);
  }, [settings.globalChartColorOrder, settings.globalChartColorsEnforced]);

  const savedOrder =
    settings.globalChartColorOrder ?? chartColorOptions.map((option) => option.color);
  const changed =
    JSON.stringify(order) !== JSON.stringify(savedOrder) ||
    enforced !== (settings.globalChartColorsEnforced === true);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await store.updateGlobalChartColors({
        globalChartColorOrder: order,
        globalChartColorsEnforced: enforced,
      });
      setMessage(
        enforced
          ? "Shared colour order saved. Users see it after their next refresh or sign-in."
          : "Shared colour policy saved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the shared chart colours.",
      );
      throw error;
    } finally {
      setSaving(false);
    }
  };

  saveRef.current = save;
  cancelRef.current = () => {
    setOrder(savedOrder);
    setEnforced(settings.globalChartColorsEnforced === true);
    setMessage("");
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: () => saveRef.current(),
      cancel: () => cancelRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setExternalDirty?.(changed);
  }, [draftContext?.setExternalDirty, changed]);

  const parentOwnsSave = Boolean(draftContext?.actions);

  const reset = async () => {
    if (
      !(await showAppConfirm(
        "Apply the default chart palette to everyone and prevent personal colour overrides?",
        { destructive: true },
      ))
    )
      return;
    setSaving(true);
    setMessage("");
    try {
      await store.resetChartColorPreferencesForAllUsers();
      setMessage(
        "Default palette applied to everyone. Users see it after their next refresh or sign-in.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not reset chart colours for all users.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-1 text-sm font-semibold">Chart colours for all users</h2>
      <div className="mb-2">
        <SettingsScope scope="shared" editors="Administrators" />
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Set a shared order for every account. Bars, columns and pie slices use this order. Users see
        policy changes after their next refresh or sign-in. Reset applies the default order to
        everyone.
      </p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={enforced}
              onChange={(event) => setEnforced(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">Use this colour order for everyone</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                When enabled, personal colour settings are overridden until this is turned off.
              </span>
            </span>
          </label>
          <ChartColorOrderField value={order} onChange={setOrder} />
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {!parentOwnsSave ? (
              <button
                type="button"
                onClick={() => void save().catch(() => undefined)}
                disabled={saving || !changed}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving..." : enforced ? "Apply to all users" : "Save colour policy"}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use the section Save changes action above to apply the shared colour policy.
              </p>
            )}
            <button
              type="button"
              onClick={() => void reset()}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Reset all users
            </button>
          </div>
          {message ? (
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AccountSettings() {
  const draftContext = useContext(SettingsDraftContext);
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionPasswordConfirmation, setDeletionPasswordConfirmation] = useState("");
  const [deletionPasswordSaving, setDeletionPasswordSaving] = useState(false);
  const [deletionPasswordMessage, setDeletionPasswordMessage] = useState("");
  const [deletionPasswordError, setDeletionPasswordError] = useState("");
  const deletionPasswordsMatch = deletionPassword === deletionPasswordConfirmation;
  const canSaveDeletionPassword =
    deletionPassword.length > 0 &&
    deletionPasswordConfirmation.length > 0 &&
    deletionPasswordsMatch;
  const deletionPasswordDirty = Boolean(deletionPassword || deletionPasswordConfirmation);
  const cancelDeletionPasswordRef = useRef(() => undefined);
  cancelDeletionPasswordRef.current = () => {
    setDeletionPassword("");
    setDeletionPasswordConfirmation("");
    setDeletionPasswordError("");
    setDeletionPasswordMessage("");
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelDeletionPasswordRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setLocalDirty?.(deletionPasswordDirty);
  }, [draftContext?.setLocalDirty, deletionPasswordDirty]);
  const savePersonalDeletionPassword = async () => {
    if (!canSaveDeletionPassword) return;
    setDeletionPasswordSaving(true);
    setDeletionPasswordMessage("");
    setDeletionPasswordError("");
    try {
      await store.saveDeletionPassword(deletionPassword, deletionPasswordConfirmation);
      setDeletionPassword("");
      setDeletionPasswordConfirmation("");
      setDeletionPasswordMessage("Your personal deletion password has been saved.");
    } catch (error) {
      setDeletionPasswordError(
        error instanceof Error ? error.message : "Unable to save the deletion password.",
      );
    } finally {
      setDeletionPasswordSaving(false);
    }
  };
  const assignedDivisionNames =
    activeUser?.divisionIds
      .map((id) => divisions.find((division) => division.id === id)?.name)
      .filter(Boolean)
      .join(", ") || (activeUser?.role === "admin" ? "All divisions" : "No divisions assigned");

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">User settings</h2>
      <p className="text-xs text-muted-foreground mb-5">Account and access details.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" value={activeUser?.name ?? "Not signed in"} />
        <Field label="Username" value={activeUser?.username ?? "Not signed in"} />
        <Field label="Role" value={activeUser ? roleLabel(activeUser.role) : "Not signed in"} />
        <Field label="Divisions" value={assignedDivisionNames} />
      </div>

      {activeUser ? (
        <section className="mt-5 rounded-md border border-border bg-background p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Personal deletion password</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This password belongs only to your account and is required for protected delete
              actions performed by you.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PasswordField
              label="Deletion password"
              value={deletionPassword}
              onChange={setDeletionPassword}
            />
            <PasswordField
              label="Reconfirm deletion password"
              value={deletionPasswordConfirmation}
              onChange={setDeletionPasswordConfirmation}
            />
          </div>
          {!deletionPasswordsMatch && deletionPasswordConfirmation ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              The deletion passwords do not match.
            </p>
          ) : null}
          {deletionPasswordError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {deletionPasswordError}
            </p>
          ) : null}
          {deletionPasswordMessage ? (
            <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
              {deletionPasswordMessage}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {settings.deletionPasswordConfigured
                ? "A personal deletion password is configured for this account. Saving here replaces it."
                : "No personal deletion password is configured for this account."}
            </p>
          )}
          <button
            type="button"
            onClick={() => void savePersonalDeletionPassword()}
            disabled={!canSaveDeletionPassword || deletionPasswordSaving}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="size-4" />
            {deletionPasswordSaving ? "Saving..." : "Save deletion password"}
          </button>
          <button
            type="button"
            onClick={() => cancelDeletionPasswordRef.current()}
            disabled={!deletionPasswordDirty || deletionPasswordSaving}
            className="mt-3 ml-2 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </section>
      ) : null}

      {(activeUser?.role === "editor" ||
        activeUser?.role === "sub_admin" ||
        activeUser?.role === "universal_viewer") && (
        <div className="mt-5 max-w-sm">
          <ThemeTintField
            label="UI tint"
            value={settings.themeTint}
            onChange={(value) => updateSettings({ themeTint: value })}
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

function AddEditRibbonSettings({ readOnly = false }: { readOnly?: boolean }) {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const rawFields = settings.addEditRibbonFields;
  const selected = normalizeAddEditRibbonFields(rawFields ?? defaultAddEditRibbonFields);
  const rawFieldSignature = JSON.stringify(rawFields);
  const selectedFieldSignature = JSON.stringify(selected);
  const hasInvalidDraft =
    Array.isArray(rawFields) && rawFieldSignature !== selectedFieldSignature;

  useEffect(() => {
    if (!hasInvalidDraft || readOnly) return;
    updateSettings({ addEditRibbonFields: selected });
  }, [hasInvalidDraft, readOnly, selectedFieldSignature, rawFieldSignature, updateSettings]);

  const updateField = (index: number, value: AddEditRibbonFieldKey) => {
    const otherValue = selected[index === 0 ? 1 : 0];
    if (value === otherValue) return;
    const next: AddEditRibbonFieldKey[] = [...selected];
    next[index] = value;
    updateSettings({ addEditRibbonFields: next });
  };

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Add/Edit file top ribbon</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Demand description is always shown on the first line. Choose the second and third line for
        this account.
      </p>
      {hasInvalidDraft && !readOnly ? (
        <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          Duplicate or invalid selections were reset to the default ribbon fields.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <RibbonFieldSelect
          label="Second line"
          value={selected[0]}
          excludeValue={selected[1]}
          onChange={(value) => updateField(0, value)}
        />
        <RibbonFieldSelect
          label="Third line"
          value={selected[1]}
          excludeValue={selected[0]}
          onChange={(value) => updateField(1, value)}
        />
      </div>
    </div>
  );
}

function OffsetDaysSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const canEditPreSoOffsets = activeUser?.role === "admin";
  const canEditCashOutGoOffsets =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    (activeUser?.role === "universal_viewer" &&
      (activeUser.cashOutgoEditScope === "personal" || activeUser.cashOutgoEditScope === "global"));
  const cashOutGoScopeNote =
    activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal"
      ? "Edits apply only to this account's personal Cash Out Go view."
      : "Authorized edits apply to the shared Cash Out Go Plan.";

  const offsets = [
    {
      label: "Pre-S.O. stage date to expected S.O. date",
      value: settings.preSoDefaultSoOffsetDays ?? 30,
      disabled: !canEditPreSoOffsets,
      onChange: (value: number) => updateSettings({ preSoDefaultSoOffsetDays: value }),
      helper: [
        "Reports → Cash Out Go Plan → Pre-S.O. based expected cash outgo → Stages.",
        "The selected pre-S.O. milestone date starts the interval used to estimate the S.O. date.",
      ],
    },
    {
      label: "Expected S.O. date to expected payment date",
      value: settings.preSoDefaultPaymentOffsetDays ?? 30,
      disabled: !canEditPreSoOffsets,
      onChange: (value: number) => updateSettings({ preSoDefaultPaymentOffsetDays: value }),
      helper: [
        "Reports → Cash Out Go Plan → Pre-S.O. based expected cash outgo → Stages.",
        "The estimated S.O. date starts the interval used to estimate the payment date.",
      ],
    },
    {
      label: "Warranty-period end to BG return due date",
      value: settings.bgReturnOffsetDays ?? 60,
      disabled: !canEditPreSoOffsets,
      onChange: (value: number) => updateSettings({ bgReturnOffsetDays: value }),
      helper: [
        "A BG must remain valid through Warranty Period Date + this offset. BG return becomes due the following day. Used by BG-return checks and the Warranty/BG comparison in Search, Dashboard, Analytics, and Reports.",
        "Administrator changes apply throughout the software.",
      ],
    },
    {
      label: "Delay Status default threshold",
      value: settings.delayStatusDefaultDays ?? 5,
      disabled: !canEditPreSoOffsets,
      onChange: (value: number) => updateSettings({ delayStatusDefaultDays: value }),
      helper: [
        "Sets the default and reset value for Analytics and Reports → Delay Status.",
        "Delay Status shows a case only when its current age is greater than this number of days. Each view can still use a temporary threshold.",
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-secondary/20 p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Shared day settings</h2>
          <div className="mt-1">
            <SettingsScope scope="shared" editors="Administrators" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shared offsets and the Delay Status default apply across Analytics and Reports;
            report-level overrides remain separate where available.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {offsets.map((offset) => (
            <label
              key={offset.label}
              className="block rounded-md border border-border bg-background p-3"
            >
              <span className="mb-1 block text-xs font-medium">{offset.label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={offset.value}
                  disabled={offset.disabled}
                  onChange={(event) =>
                    offset.onChange(Math.max(0, Number(event.target.value || 0)))
                  }
                  className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </span>
              <span className="mt-2 block space-y-1 text-xs leading-relaxed text-muted-foreground">
                {offset.helper.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      </section>
      <CashOutGoOffsetSettings canEdit={canEditCashOutGoOffsets} scopeNote={cashOutGoScopeNote} />
    </div>
  );
}

function WorkspaceSettings() {
  const draftContext = useContext(SettingsDraftContext);
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const [selectedYearFileCount, setSelectedYearFileCount] = useState(-1);
  const [yearUsageError, setYearUsageError] = useState("");
  const [yearUsageRetry, setYearUsageRetry] = useState(0);
  const [yearArchiveSaving, setYearArchiveSaving] = useState(false);
  const [yearArchiveFeedback, setYearArchiveFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [yearDeleteFeedback, setYearDeleteFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [newFinancialYearSaving, setNewFinancialYearSaving] = useState(false);
  const [newFinancialYear, setNewFinancialYear] = useState("");
  const [newFinancialYearFeedback, setNewFinancialYearFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
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
    setSelectedYearFileCount(-1);
    setYearUsageError("");
    store
      .getFinancialYearUsageCount(workspaceYear)
      .then((payload) => {
        if (!cancelled) setSelectedYearFileCount(payload.count);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setSelectedYearFileCount(-1);
          setYearUsageError(
            "Could not check whether this year has files. Retry before deleting it.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceYear, yearUsageRetry]);
  const canDeleteSelectedYear =
    workspaceYear !== settings.financialYear &&
    selectedYearFileCount === 0 &&
    !yearUsageError &&
    financialYears.length > 1;
  const canEditWorkspaceGlobals = activeUser?.role === "admin";
  const canManageYearArchive = activeUser?.role === "admin";
  const selectedYearArchived =
    settings.financialYearStatuses?.some(
      (status) => status.label === workspaceYear && status.archived,
    ) ?? false;
  const addFinancialYear = async () => {
    if (newFinancialYearSaving) return;
    const label = newFinancialYear.trim() || suggestedFinancialYear;
    if (!label) return;
    const error = validateNewFinancialYearLabel(label, financialYears);
    if (error) {
      setNewFinancialYearFeedback({ kind: "error", message: error });
      return;
    }
    setNewFinancialYearSaving(true);
    setNewFinancialYearFeedback(null);
    try {
      await store.addFinancialYear(label, true);
      setNewFinancialYear("");
      setNewFinancialYearFeedback({
        kind: "success",
        message: `FY ${displayFinancialYearLabel(label)} was created and set as Setup FY.`,
      });
    } catch (caught) {
      setNewFinancialYear(label);
      setNewFinancialYearFeedback({
        kind: "error",
        message:
          caught instanceof Error ? caught.message : "Financial year could not be created.",
      });
    } finally {
      setNewFinancialYearSaving(false);
    }
  };

  const setCurrentFinancialYear = () => {
    if (workspaceYear === settings.financialYear || selectedYearArchived) return;
    updateSettings({
      financialYear: workspaceYear,
      selectedYear: ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
      setupYear: workspaceYear,
    });
  };

  const toggleYearSelectionLock = () => {
    updateSettings({ yearSelectionLocked: !settings.yearSelectionLocked });
  };

  const setSelectedYearArchived = async (archived: boolean) => {
    if (!canManageYearArchive || workspaceYear === settings.financialYear) return;
    const label = workspaceYear;
    const nextStatuses = (settings.financialYearStatuses ?? []).map((status) =>
      status.label === label ? { ...status, archived } : status,
    );
    setYearArchiveSaving(true);
    setYearArchiveFeedback(null);
    try {
      await store.saveSettings({ financialYearStatuses: nextStatuses });
      setYearArchiveFeedback({
        kind: "success",
        message: `FY ${displayFinancialYearLabel(label)} ${archived ? "archived" : "restored"}.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Financial-year archive could not be updated.";
      setYearArchiveFeedback({ kind: "error", message });
      throw error;
    } finally {
      setYearArchiveSaving(false);
    }
  };

  const deleteSelectedFinancialYear = async () => {
    if (!canDeleteSelectedYear) return;
    const label = workspaceYear;
    if (await requestDeletionPassword(`delete financial year "${workspaceYear}"`)) {
      setYearDeleteFeedback(null);
      try {
        await store.deleteFinancialYear(label);
        setWorkspaceYear(settings.financialYear);
        setYearDeleteFeedback({
          kind: "success",
          message: `FY ${displayFinancialYearLabel(label)} deleted.`,
        });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Financial year could not be deleted.";
        setYearDeleteFeedback({ kind: "error", message });
        throw caught;
      }
    }
  };

  const workspaceDraftDirty = Boolean(newFinancialYear.trim());
  const cancelWorkspaceDraftsRef = useRef(() => undefined);
  cancelWorkspaceDraftsRef.current = () => {
    setNewFinancialYear("");
    setNewFinancialYearFeedback(null);
    setWorkspaceYear(settings.financialYear);
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelWorkspaceDraftsRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setLocalDirty?.(workspaceDraftDirty);
  }, [draftContext?.setLocalDirty, workspaceDraftDirty]);

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
                Manage financial years and the Add File year lock. Create, archive, restore, and delete apply immediately; Current FY and year-lock changes wait for Save changes.
              </p>
            </div>
            <span className="rounded bg-background px-2 py-1 text-xs text-muted-foreground">
              Current: {displayFinancialYearLabel(settings.financialYear)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(260px,1fr)]">
            <label className="block">
              <div className="mb-1.5 text-xs font-medium">FY</div>
              <SearchableDropdown
                value={workspaceYear}
                onChange={(year) => {
                  setWorkspaceYear(year || settings.financialYear);
                  setYearArchiveFeedback(null);
                  setYearDeleteFeedback(null);
                }}
                options={[]}
                optionItems={financialYears.map((year) => ({
                  value: year,
                  label: displayFinancialYearLabel(year),
                }))}
                placeholder="Select financial year"
                deferChangeUntilSelect
                allowCustomValue={false}
                disabled={!canEditWorkspaceGlobals && !canManageYearArchive}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>

            <div className="block">
              <label htmlFor="workspace-add-year" className="mb-1.5 block text-xs font-medium">
                New financial year
              </label>
              <div className="flex gap-2">
                <input
                  id="workspace-add-year"
                  value={newFinancialYear || suggestedFinancialYear}
                  onChange={(event) => {
                    setNewFinancialYear(event.target.value);
                    setNewFinancialYearFeedback(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addFinancialYear();
                  }}
                  placeholder={suggestedFinancialYear}
                  disabled={!canEditWorkspaceGlobals || newFinancialYearSaving}
                  className="h-10 min-w-0 flex-1 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
                <button
                  type="button"
                  onClick={() => void addFinancialYear()}
                  disabled={!canEditWorkspaceGlobals || newFinancialYearSaving}
                  className="h-10 shrink-0 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                >
                  <Plus className="size-4" />
                  {newFinancialYearSaving ? "Creating..." : "Create FY now"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Creates the year immediately and sets it as Setup FY; Current FY stays unchanged. A failed attempt keeps the entered year here.
              </p>
              {newFinancialYearFeedback ? (
                <div
                  role={newFinancialYearFeedback.kind === "error" ? "alert" : "status"}
                  className={
                    "mt-1.5 text-xs " +
                    (newFinancialYearFeedback.kind === "error"
                      ? "text-destructive"
                      : "text-emerald-700 dark:text-emerald-300")
                  }
                >
                  {newFinancialYearFeedback.message}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
              <button
                type="button"
                onClick={setCurrentFinancialYear}
                disabled={
                  !canEditWorkspaceGlobals ||
                  workspaceYear === settings.financialYear ||
                  selectedYearArchived
                }
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
                helper={workspaceYearHelpers.archive}
                label="Archive financial year help"
              >
                {selectedYearArchived ? (
                  <button
                    type="button"
                    onClick={() => void setSelectedYearArchived(false).catch(() => undefined)}
                    disabled={
                      yearArchiveSaving ||
                      !canManageYearArchive ||
                      workspaceYear === settings.financialYear
                    }
                    className="h-10 min-w-36 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                  >
                    {yearArchiveSaving ? "Restoring..." : "Restore FY now"}
                  </button>
                ) : (
                  <DeleteConfirmation
                    mode="archive"
                    actionLabel="Archive FY now"
                    description={`FY ${displayFinancialYearLabel(workspaceYear)} will be archived immediately. Its records will be retained.`}
                    onConfirm={() => setSelectedYearArchived(true)}
                  >
                    <button
                      type="button"
                      disabled={
                        yearArchiveSaving ||
                        !canManageYearArchive ||
                        workspaceYear === settings.financialYear
                      }
                      className="h-10 min-w-36 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {yearArchiveSaving ? "Archiving..." : "Archive FY now"}
                    </button>
                  </DeleteConfirmation>
                )}
              </HelpedControl>

              <HelpedControl
                helper={settingsControlHelpers.workspaceDelete}
                label="Delete financial year help"
              >
                <DeleteConfirmation
                  actionLabel="Delete FY now"
                  description={`FY ${displayFinancialYearLabel(workspaceYear)} will be deleted immediately. Deletion is available only when the year has no files.`}
                  onConfirm={deleteSelectedFinancialYear}
                >
                  <button
                    type="button"
                    disabled={!canEditWorkspaceGlobals || !canDeleteSelectedYear}
                    className="h-10 min-w-32 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-background text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" /> Delete FY now
                  </button>
                </DeleteConfirmation>
              </HelpedControl>
              {selectedYearFileCount < 0 && !yearUsageError ? (
                <span className="text-xs text-muted-foreground">Checking year records...</span>
              ) : null}
              {yearUsageError ? (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>{yearUsageError}</span>
                  <button
                    type="button"
                    onClick={() => setYearUsageRetry((current) => current + 1)}
                    className="font-semibold underline underline-offset-2"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
              {yearArchiveFeedback ? (
                <span
                  role={yearArchiveFeedback.kind === "error" ? "alert" : "status"}
                  className={
                    "text-xs " +
                    (yearArchiveFeedback.kind === "error"
                      ? "text-destructive"
                      : "text-emerald-700 dark:text-emerald-300")
                  }
                >
                  {yearArchiveFeedback.message}
                </span>
              ) : null}
              {yearDeleteFeedback ? (
                <span
                  role={yearDeleteFeedback.kind === "error" ? "alert" : "status"}
                  className={
                    "text-xs " +
                    (yearDeleteFeedback.kind === "error"
                      ? "text-destructive"
                      : "text-emerald-700 dark:text-emerald-300")
                  }
                >
                  {yearDeleteFeedback.message}
                </span>
              ) : null}
            </div>
            <p className="xl:col-span-2 text-xs text-muted-foreground">
              “Set as Current FY” and the year-selection lock are drafts. Use the Settings “Save changes” action to apply them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TcecCommitteeSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const committees = settings.tcecCommittees ?? [];
  const rows = getMasterValueUsageRows(committees, getTcecCommitteeUsage(files));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateCommittees = (next: string[]) => {
    updateSettings({ tcecCommittees: next });
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

  const activate = (committee: string) => {
    const exists = committees.some((item) => item.toLowerCase() === committee.toLowerCase());
    if (!exists) updateCommittees([...committees, committee]);
  };

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">TCEC Committee</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add committee names for selection in TCEC fields.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Committee name" />
        <HelpedControl helper={settingsControlHelpers.genericAdd} label="Add TCEC committee help">
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
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No committee names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.value} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{row.value}</span>
                  <MasterValueMeta row={row} />
                </div>
                <MasterValueActions
                  row={row}
                  onActivate={() => activate(row.value)}
                  onDeactivate={() => remove(row.value)}
                  onDelete={() => remove(row.value)}
                  label={row.value}
                />
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
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const firmTypes = normalizeFirmTypes(settings.firmTypes);
  const rows = getMasterValueUsageRows(firmTypes, getFirmTypeUsage(files));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateFirmTypes = (next: string[]) => {
    updateSettings({ firmTypes: normalizeFirmTypes(next) });
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

  const activate = (firmType: string) => {
    const exists = firmTypes.some((item) => item.toLowerCase() === firmType.toLowerCase());
    if (!exists) updateFirmTypes([...firmTypes, firmType]);
  };

  const activeRows = rows.filter((row) => row.status === "active");
  const inactiveRows = rows.filter((row) => row.status === "inactive");

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No firm types added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeRows.map((row) => {
              const index = firmTypes.findIndex(
                (firmType) => firmType.toLowerCase() === row.value.toLowerCase(),
              );
              const usedFirmType = row.usageCount > 0;
              return (
                <li key={`${row.value}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <ClearableInput
                      value={row.value}
                      onChange={(event) => rename(index, event.target.value)}
                      onClear={() => rename(index, "")}
                      disabled={usedFirmType}
                      title={
                        usedFirmType
                          ? "Used firm type cannot be renamed. Inactivate it to hide from future dropdowns."
                          : undefined
                      }
                      className={
                        "h-9 w-full min-w-0 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (usedFirmType ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                      }
                    />
                    <MasterValueMeta row={row} />
                  </div>
                  <MasterValueActions
                    row={row}
                    onActivate={() => activate(row.value)}
                    onDeactivate={() => remove(index)}
                    onDelete={() => remove(index)}
                    label={row.value}
                  />
                </li>
              );
            })}
            {inactiveRows.map((row) => (
              <li key={`inactive-${row.value}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-muted-foreground">{row.value}</div>
                  <MasterValueMeta row={row} />
                </div>
                <MasterValueActions
                  row={row}
                  onActivate={() => activate(row.value)}
                  onDeactivate={() => undefined}
                  onDelete={() => undefined}
                  label={row.value}
                />
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
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const modes = normalizeModes(settings.modes);
  const modeUsage = getModeUsage(files);
  const rows = getMasterValueUsageRows(modes, modeUsage, { uppercase: true });

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateModes = (next: string[]) => {
    updateSettings({ modes: normalizeModes(next) });
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
    const mode = modes[index];
    if (isDefaultMode(mode) && !modeUsage.get(normalizeMasterKey(mode ?? ""))?.fileIds.size) {
      return;
    }
    updateModes(modes.filter((_, itemIndex) => itemIndex !== index));
  };

  const activate = (mode: string) => {
    const normalized = mode.trim().toUpperCase();
    const exists = modes.some((item) => item.trim().toUpperCase() === normalized);
    if (!exists) updateModes([...modes, normalized]);
  };

  const activeRows = rows.filter((row) => row.status === "active");
  const inactiveRows = rows.filter((row) => row.status === "inactive");

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Modes</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add and edit the mode values shown in File details, Search, and Dashboard Snapshot.
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
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No modes added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeRows.map((row) => {
              const index = modes.findIndex((mode) => mode.trim().toUpperCase() === row.value);
              const protectedMode = isDefaultMode(row.value);
              const usedMode = row.usageCount > 0;
              const lockedModeName = protectedMode || usedMode;
              return (
                <li key={`${row.value}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <ClearableInput
                      value={row.value}
                      onChange={(event) => rename(index, event.target.value)}
                      onClear={() => rename(index, "")}
                      disabled={lockedModeName}
                      title={
                        usedMode
                          ? "Used mode cannot be renamed. Inactivate it to hide from future dropdowns."
                          : undefined
                      }
                      className={
                        "h-9 w-full min-w-0 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (lockedModeName ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                      }
                    />
                    <MasterValueMeta row={row} />
                  </div>
                  {protectedMode && !usedMode ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[0.6875rem] font-medium text-muted-foreground">
                      Default
                    </span>
                  ) : (
                    <MasterValueActions
                      row={row}
                      onActivate={() => activate(row.value)}
                      onDeactivate={() => remove(index)}
                      onDelete={() => remove(index)}
                      label={row.value}
                    />
                  )}
                </li>
              );
            })}
            {inactiveRows.map((row) => (
              <li key={`inactive-${row.value}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-muted-foreground">{row.value}</div>
                  <MasterValueMeta row={row} />
                </div>
                <MasterValueActions
                  row={row}
                  onActivate={() => activate(row.value)}
                  onDeactivate={() => undefined}
                  onDelete={() => undefined}
                  label={row.value}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GemBiddingModeSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const modes = normalizeGemBiddingModes(settings.gemBiddingModes);
  const modeUsage = getGemBiddingModeUsage(files);
  const defaultModeKeys = new Set(defaultGemBiddingModes.map((mode) => mode.toLowerCase()));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || modes.some((mode) => mode.toLowerCase() === trimmed.toLowerCase())) return;
    updateSettings({ gemBiddingModes: [...modes, trimmed] });
    setName("");
  };

  return (
    <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-1 text-sm font-semibold">GeM Bidding Modes</h2>
      <p className="mb-5 text-xs text-muted-foreground">
        Add a choice for future GeM entries. Existing file values are not changed.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="GeM bidding mode" />
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>
      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {modes.map((mode) => {
          const usageCount = modeUsage.get(normalizeMasterKey(mode))?.fileIds.size ?? 0;
          const isBuiltIn = defaultModeKeys.has(mode.toLowerCase());
          const cannotDelete = usageCount > 0 || isBuiltIn;
          return (
            <li key={mode} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                {mode}
                {isBuiltIn ? (
                  <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                    Default
                  </span>
                ) : null}
                {usageCount > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Used by {usageCount} file{usageCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
              <DeleteConfirmation
                mode="draft"
                onConfirm={() =>
                  updateSettings({ gemBiddingModes: modes.filter((item) => item !== mode) })
                }
              >
                <button
                  type="button"
                  disabled={cannotDelete}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Delete ${mode} GeM bidding mode`}
                  title={
                    usageCount > 0
                      ? `In use by ${usageCount} file${usageCount === 1 ? "" : "s"}`
                      : isBuiltIn
                        ? "Built-in modes cannot be removed"
                        : `Delete ${mode}`
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </DeleteConfirmation>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function normalizeGemBiddingModes(values: string[] | undefined) {
  const defaults = defaultGemBiddingModes;
  const seen = new Set<string>();
  return [...defaults, ...(values ?? [])]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const defaultGemBiddingModes = ["Custom", "Catalogue", "Comparison"];

function FileTypeSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const [newFileTypeGroup, setNewFileTypeGroup] = useState<FileTypeGroup | "">("");
  const fileTypes = normalizeFileTypes(settings.fileTypes);
  const fileTypeGroups = normalizeFileTypeGroups(settings.fileTypeGroups, fileTypes);
  const fileTypeUsage = getFileTypeUsage(files);
  const rows = getMasterValueUsageRows(fileTypes, fileTypeUsage);

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateFileTypes = (next: string[], nextGroups: FileTypeGroupSetting[] = fileTypeGroups) => {
    const normalizedTypes = normalizeFileTypes(next);
    updateSettings({
      fileTypes: normalizedTypes,
      fileTypeGroups: normalizeFileTypeGroups(nextGroups, normalizedTypes),
    });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || !newFileTypeGroup) return;
    const exists = fileTypes.some((fileType) => fileType.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      updateFileTypes(
        [...fileTypes, trimmed],
        [...fileTypeGroups, { fileType: trimmed, group: newFileTypeGroup }],
      );
    }
    setName("");
    setNewFileTypeGroup("");
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
    const removed = fileTypes[index];
    if (
      isDefaultFileType(removed) &&
      !fileTypeUsage.get(normalizeMasterKey(removed ?? ""))?.fileIds.size
    ) {
      return;
    }
    updateFileTypes(
      fileTypes.filter((_, itemIndex) => itemIndex !== index),
      fileTypeGroups.filter(
        (entry) => entry.fileType.trim().toLowerCase() !== removed.trim().toLowerCase(),
      ),
    );
  };

  const activate = (fileType: string) => {
    const exists = fileTypes.some((item) => item.toLowerCase() === fileType.toLowerCase());
    if (!exists) updateFileTypes([...fileTypes, fileType]);
  };

  const activeRows = rows.filter((row) => row.status === "active");
  const inactiveRows = rows.filter((row) => row.status === "inactive");

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">File Types</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Name and workflow group are locked once any active or archived file uses the file type.
        Unused file types can still be edited or removed.
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
            <option value="">Select workflow group</option>
            {fileTypeGroupOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SettingsHelper
            items={settingsControlHelpers.fileTypeGroup}
            label="File type group help"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!name.trim() || !newFileTypeGroup}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No file types added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeRows.map((row) => {
              const index = fileTypes.findIndex(
                (fileType) => fileType.toLowerCase() === row.value.toLowerCase(),
              );
              const fileType = row.value;
              const usedFileType = row.usageCount > 0;
              const protectedFileType = isDefaultFileType(fileType) && !usedFileType;
              const lockedFileTypeName = isDefaultFileType(fileType) || usedFileType;
              return (
                <li
                  key={`${fileType}-${index}`}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px_auto]"
                >
                  <div>
                    <ClearableInput
                      value={fileType}
                      onChange={(event) => rename(index, event.target.value)}
                      onClear={() => rename(index, "")}
                      disabled={lockedFileTypeName}
                      className={
                        "h-9 w-full min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (lockedFileTypeName
                          ? "bg-secondary/50 text-muted-foreground"
                          : "bg-background")
                      }
                    />
                    <MasterValueMeta row={row} />
                  </div>
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
                      disabled={usedFileType}
                      className={
                        "h-9 min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (usedFileType ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                      }
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
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[0.6875rem] font-medium text-muted-foreground">
                      {usedFileType ? "In use" : "Default"}
                    </span>
                  ) : (
                    <MasterValueActions
                      row={row}
                      onActivate={() => activate(fileType)}
                      onDeactivate={() => remove(index)}
                      onDelete={() => remove(index)}
                      label={fileType}
                    />
                  )}
                </li>
              );
            })}
            {inactiveRows.map((row) => (
              <li
                key={`inactive-${row.value}`}
                className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px_auto]"
              >
                <div className="text-sm font-medium text-muted-foreground">
                  {row.value}
                  <MasterValueMeta row={row} />
                </div>
                <span className="text-xs text-muted-foreground">Historical value</span>
                <MasterValueActions
                  row={row}
                  onActivate={() => activate(row.value)}
                  onDeactivate={() => undefined}
                  onDelete={() => undefined}
                  label={row.value}
                />
              </li>
            ))}
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
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const markers = normalizeSpecialFileMarkers(settings.specialFileMarkers);
  const rows = getSpecialFileMarkerUsageRows(markers, getFileMarkerUsage(files));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateMarkers = (next: SpecialFileMarker[]) => {
    updateSettings({ specialFileMarkers: normalizeSpecialFileMarkers(next) });
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

  const activate = (marker: SpecialFileMarker) => {
    const exists = markers.some((item) => item.code === marker.code);
    if (!exists) updateMarkers([...markers, marker]);
  };

  const activeRows = rows.filter((row) => row.status === "active");
  const inactiveRows = rows.filter((row) => row.status === "inactive");

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No marker codes added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeRows.map((row) => {
              const index = markers.findIndex((marker) => marker.code === row.marker.code);
              const usedMarker = row.usageCount > 0;
              return (
                <li
                  key={`${row.marker.code}-${index}`}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[12rem_1fr_auto]"
                >
                  <div>
                    <ClearableInput
                      value={row.marker.code}
                      onChange={(event) => rename(index, event.target.value)}
                      onClear={() => rename(index, "")}
                      disabled={usedMarker}
                      title={
                        usedMarker
                          ? "Used marker code cannot be renamed. Inactivate it to hide from future dropdowns."
                          : undefined
                      }
                      className={
                        "h-9 w-full min-w-0 rounded-md border border-input px-3 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-ring/40 " +
                        (usedMarker ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                      }
                    />
                    <MasterValueMeta row={row} />
                  </div>
                  <ClearableInput
                    value={row.marker.description}
                    onChange={(event) => updateDescription(index, event.target.value)}
                    onClear={() => updateDescription(index, "")}
                    className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <MasterValueActions
                    row={row}
                    onActivate={() => activate(row.marker)}
                    onDeactivate={() => remove(index)}
                    onDelete={() => remove(index)}
                    label={row.marker.code}
                  />
                </li>
              );
            })}
            {inactiveRows.map((row) => (
              <li
                key={`inactive-${row.marker.code}`}
                className="grid gap-3 px-4 py-3 md:grid-cols-[12rem_1fr_auto]"
              >
                <div>
                  <div className="text-sm font-semibold text-muted-foreground">
                    {row.marker.code}
                  </div>
                  <MasterValueMeta row={row} />
                </div>
                <div className="text-sm text-muted-foreground">
                  {row.marker.description || "Inactive historical marker code"}
                </div>
                <MasterValueActions
                  row={row}
                  onActivate={() => activate(row.marker)}
                  onDeactivate={() => undefined}
                  onDelete={() => undefined}
                  label={row.marker.code}
                />
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
  const normalized = (values === undefined ? defaultFirmTypes : values)
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return normalized;
}

function normalizeFileTypes(values: string[] | undefined) {
  const seen = new Set<string>();
  const normalized = (values === undefined ? defaultFileTypes : values)
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return normalized;
}

function normalizeModes(values: string[] | undefined) {
  const seen = new Set<string>();
  const normalized = (values === undefined ? defaultModes : values)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  return normalized;
}

function isDefaultFileType(fileType: string | undefined) {
  const normalized = fileType?.trim().toLowerCase();
  return Boolean(normalized && defaultFileTypes.some((item) => item.toLowerCase() === normalized));
}

function isDefaultMode(mode: string | undefined) {
  const normalized = mode?.trim().toUpperCase();
  return Boolean(normalized && defaultModes.includes(normalized));
}

function validateRangeContinuity(
  ranges: Array<{ label: string; min?: number; max?: number }>,
  unitGap: number,
) {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => (a.min ?? Number.NEGATIVE_INFINITY) - (b.min ?? Number.NEGATIVE_INFINITY));
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current.min !== undefined && current.max !== undefined && current.min > current.max) {
      return `${current.label}: minimum cannot be greater than maximum.`;
    }
    const next = sorted[index + 1];
    if (!next) continue;
    if (current.max === undefined) {
      return `${current.label}: open-ended range must be the last range.`;
    }
    if (next.min === undefined) {
      return `${next.label}: minimum is required after another range.`;
    }
    if (next.min <= current.max) {
      return `${next.label} overlaps with ${current.label}. Next minimum must be higher than previous maximum.`;
    }
    if (next.min > current.max + unitGap) {
      return `Gap found between ${current.label} and ${next.label}.`;
    }
  }
  return "";
}

function validateValueThresholdRanges(levels: ValueThresholdLevel[]) {
  const metrics: Array<{ key: ValueThresholdAppliesTo; label: string }> = [
    { key: "capital", label: "Capital value" },
    { key: "revenue", label: "Revenue value" },
  ];
  for (const metric of metrics) {
    const ranges = levels
      .filter((level) => level.appliesTo === "both" || level.appliesTo === metric.key)
      .map((level) => {
        const min = parseOptionalPositiveNumber(level.minValue);
        const max = parseOptionalPositiveNumber(level.maxValue);
        if (min.invalid || max.invalid) {
          return { error: `${level.label}: enter valid positive threshold values.` };
        }
        return {
          label: `${metric.label} ${level.label}`,
          min: min.value,
          max: max.value,
        };
      });
    const invalid = ranges.find((range): range is { error: string } => "error" in range);
    if (invalid) return invalid.error;
    const message = validateRangeContinuity(
      ranges.filter(
        (range): range is { label: string; min?: number; max?: number } => !("error" in range),
      ),
      1,
    );
    if (message) return message;
  }
  return "";
}

function normalizeMasterKey(value: string, uppercase = false) {
  const trimmed = value.trim();
  return uppercase ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

function addUsage(
  usage: Map<string, { value: string; fileIds: Set<string> }>,
  fileId: string,
  rawValue: string | undefined,
  options: { uppercase?: boolean } = {},
) {
  const value = rawValue?.trim();
  if (!value) return;
  const displayValue = options.uppercase ? value.toUpperCase() : value;
  const key = normalizeMasterKey(displayValue, options.uppercase);
  const row = usage.get(key) ?? { value: displayValue, fileIds: new Set<string>() };
  row.fileIds.add(fileId);
  usage.set(key, row);
}

function getFirmTypeUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.firmType);
    file.supplyOrders?.forEach((order) => addUsage(usage, file.id, order.firmType));
  });
  return usage;
}

function getModeUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => addUsage(usage, file.id, file.mode, { uppercase: true }));
  return usage;
}

function getGemBiddingModeUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.gemBiddingMode);
    addUsage(usage, file.id, file.refloatGemBiddingMode);
  });
  return usage;
}

function getTcecCommitteeUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.preTcecCommitteeNo);
    addUsage(usage, file.id, file.postTcecCommitteeNumber);
    addUsage(usage, file.id, file.refloatPostTcecCommitteeNo);
  });
  return usage;
}

function getFileMarkerUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    file.markers?.forEach((marker) => addUsage(usage, file.id, marker.text, { uppercase: true }));
  });
  return usage;
}

function getDivisionUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.divisionId);
    addUsage(usage, file.id, file.division);
  });
  return usage;
}

function getFileTypeUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => addUsage(usage, file.id, file.fileType));
  return usage;
}

function getMilestoneUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.currentMilestone);
    file.completedMilestones?.forEach((milestone) => addUsage(usage, file.id, milestone));
    file.supplyOrders?.forEach((order) => {
      addUsage(usage, file.id, order.currentMilestone);
      order.completedMilestones?.forEach((milestone) => addUsage(usage, file.id, milestone));
      order.stageDeliveries?.forEach((stage) => {
        addUsage(usage, file.id, stage.currentMilestone);
        stage.completedMilestones?.forEach((milestone) => addUsage(usage, file.id, milestone));
      });
      order.advancePaymentDetail?.completedMilestones?.forEach((milestone) =>
        addUsage(usage, file.id, milestone),
      );
      addUsage(usage, file.id, order.advancePaymentDetail?.currentMilestone);
    });
  });
  return usage;
}

function getFirmUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    addUsage(usage, file.id, file.firm);
    addUsage(usage, file.id, file.firmUniqueNo);
    file.supplyOrders?.forEach((order) => {
      addUsage(usage, file.id, order.firm);
      addUsage(usage, file.id, order.firmUniqueNo);
    });
  });
  return usage;
}

function getIndentorUsage(files: FileRecord[]) {
  const usage = new Map<string, { value: string; fileIds: Set<string> }>();
  files.forEach((file) => {
    const name = file.indentor?.trim();
    const divisionId = file.divisionId?.trim();
    if (!name || !divisionId) return;
    const key = `${normalizeMasterKey(name)}\u0000${normalizeMasterKey(divisionId)}`;
    const row = usage.get(key) ?? { value: name, fileIds: new Set<string>() };
    row.fileIds.add(file.id);
    usage.set(key, row);
  });
  return usage;
}

function getIndentorUsageKey(name: string, divisionId: string) {
  return `${normalizeMasterKey(name)}\u0000${normalizeMasterKey(divisionId)}`;
}

function getFirmUsageCount(
  firm: MasterFirm,
  usage: Map<string, { value: string; fileIds: Set<string> }>,
) {
  const fileIds = new Set<string>();
  [firm.firmName, firm.firmUniqueNo].forEach((value) => {
    const key = normalizeMasterKey(value ?? "");
    if (!key) return;
    usage.get(key)?.fileIds.forEach((fileId) => fileIds.add(fileId));
  });
  return fileIds.size;
}

function getDivisionUsageCount(
  division: Division,
  usage: Map<string, { value: string; fileIds: Set<string> }>,
) {
  const fileIds = new Set<string>();
  [division.id, division.name, division.code].forEach((value) => {
    const key = normalizeMasterKey(value ?? "");
    if (!key) return;
    usage.get(key)?.fileIds.forEach((fileId) => fileIds.add(fileId));
  });
  return fileIds.size;
}

function getMasterValueUsageRows(
  activeValues: string[],
  usage: Map<string, { value: string; fileIds: Set<string> }>,
  options: { uppercase?: boolean } = {},
): MasterValueUsageRow[] {
  const activeKeys = new Set(
    activeValues.map((value) => normalizeMasterKey(value, options.uppercase)),
  );
  const activeRows = activeValues.map((value) => {
    const displayValue = options.uppercase ? value.trim().toUpperCase() : value.trim();
    const key = normalizeMasterKey(displayValue, options.uppercase);
    return {
      value: displayValue,
      usageCount: usage.get(key)?.fileIds.size ?? 0,
      status: "active" as const,
    };
  });
  const inactiveRows = Array.from(usage.entries())
    .filter(([key]) => !activeKeys.has(key))
    .map(([, row]) => ({
      value: row.value,
      usageCount: row.fileIds.size,
      status: "inactive" as const,
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
  return [...activeRows, ...inactiveRows];
}

function getSpecialFileMarkerUsageRows(
  activeMarkers: SpecialFileMarker[],
  usage: Map<string, { value: string; fileIds: Set<string> }>,
) {
  const activeCodes = new Set(activeMarkers.map((marker) => marker.code.trim().toUpperCase()));
  const activeRows = activeMarkers.map((marker) => {
    const code = marker.code.trim().toUpperCase();
    return {
      marker: { ...marker, code },
      value: code,
      usageCount: usage.get(code)?.fileIds.size ?? 0,
      status: "active" as const,
    };
  });
  const inactiveRows = Array.from(usage.entries())
    .filter(([code]) => !activeCodes.has(code))
    .map(([, row]) => ({
      marker: { code: row.value, description: "Inactive historical marker code" },
      value: row.value,
      usageCount: row.fileIds.size,
      status: "inactive" as const,
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
  return [...activeRows, ...inactiveRows];
}

function MasterValueMeta({ row }: { row: MasterValueUsageRow }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
      <span
        className={
          "inline-flex items-center rounded-md border px-2 py-0.5 font-medium " +
          (row.status === "active"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700")
        }
      >
        {row.status === "active" ? "Active" : "Inactive"}
      </span>
      <span>
        Used in {row.usageCount} file{row.usageCount === 1 ? "" : "s"} including Archive
      </span>
    </div>
  );
}

function MasterValueActions({
  row,
  onActivate,
  onDeactivate,
  onDelete,
  label,
}: {
  row: MasterValueUsageRow;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  label: string;
}) {
  if (row.status === "inactive") {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent"
      >
        <Check className="size-3.5" /> Activate
      </button>
    );
  }

  if (row.usageCount > 0) {
    return (
      <button
        type="button"
        onClick={onDeactivate}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent"
        aria-label={`Inactivate ${label}`}
        title={`Used in ${row.usageCount} file${row.usageCount === 1 ? "" : "s"} including Archive. Inactivate it to hide it from new entries while keeping historical values.`}
      >
        <Lock className="size-3.5" /> Inactivate
      </button>
    );
  }

  return (
    <HelpedControl helper={settingsControlHelpers.genericDelete} label={`Delete ${label} help`}>
      <DeleteConfirmation mode="draft" onConfirm={onDelete}>
        <button
          type="button"
          className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
          aria-label={`Delete ${label}`}
        >
          <Trash2 className="size-4" />
        </button>
      </DeleteConfirmation>
    </HelpedControl>
  );
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
  const draft = useContext(SettingsDraftContext);
  const activeUser = useActiveUser();
  const [levels, setLevels] = useState<ValueThresholdLevel[]>(() =>
    formatThresholdLevels(settings.valueThresholdLevels ?? []),
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLevels(formatThresholdLevels(settings.valueThresholdLevels ?? []));
    setMessage("");
  }, [settings.valueThresholdLevels]);

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
  const cancelThresholdsRef = useRef(() => undefined);
  cancelThresholdsRef.current = () => {
    setLevels(formatThresholdLevels(settings.valueThresholdLevels ?? []));
    setMessage("");
  };

  useEffect(() => {
    if (!draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelThresholdsRef.current(),
    });
    return () => draft.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setLocalDirty?.(thresholdsChanged);
  }, [draft?.setLocalDirty, thresholdsChanged]);
  const save = async (nextLevels = levels) => {
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
    const rangeMessage = validateValueThresholdRanges(normalized);
    if (rangeMessage) {
      setMessage(rangeMessage);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await store.saveSettings({ valueThresholdLevels: normalized });
      setLevels(normalized);
      setMessage("Thresholds saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save thresholds.");
    } finally {
      setSaving(false);
    }
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Value thresholds</h2>
          <p className="text-xs text-muted-foreground">
            Configure shared value levels for all financial years. Enter limits in rupees.
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
                    <ClearableInput
                      value={level.label}
                      onChange={(event) => updateLevel(index, { label: event.target.value })}
                      onClear={() => updateLevel(index, { label: "" })}
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
                    <ClearableInput
                      value={level.minValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          minValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      onClear={() => updateLevel(index, { minValue: "" })}
                      inputMode="decimal"
                      placeholder="No minimum"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <ClearableInput
                      value={level.maxValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          maxValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      onClear={() => updateLevel(index, { maxValue: "" })}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => cancelThresholdsRef.current()}
            disabled={!thresholdsChanged || saving}
            className="h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!thresholdsChanged || saving}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-4" /> {saving ? "Saving..." : "Save thresholds"}
          </button>
        </div>
      </div>
    </div>
  );
}

const defaultBgReceiptDelayDays = [10, 30, 60];

function normalizeBgReceiptDelaySettings(value: number[] | undefined) {
  const thresholds = Array.from(
    new Set(
      (value ?? defaultBgReceiptDelayDays).filter((days) => Number.isInteger(days) && days >= 0),
    ),
  )
    .sort((left, right) => left - right)
    .slice(0, 6);
  return thresholds.length ? thresholds : defaultBgReceiptDelayDays;
}

function BgReceiptDelaySettings() {
  const settings = useSettings();
  const draft = useContext(SettingsDraftContext);
  const activeUser = useActiveUser();
  const [days, setDays] = useState(() =>
    normalizeBgReceiptDelaySettings(settings.bgReceiptDelayDays).map(String),
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDays(normalizeBgReceiptDelaySettings(settings.bgReceiptDelayDays).map(String));
    setMessage("");
  }, [settings.bgReceiptDelayDays]);

  const normalized = days.map((value) => Number(value));
  const valid =
    days.length > 0 &&
    days.length <= 6 &&
    days.every((value) => /^\d+$/.test(value.trim())) &&
    normalized.every((value) => Number.isInteger(value) && value >= 0) &&
    new Set(normalized).size === normalized.length;
  const savedDays = normalizeBgReceiptDelaySettings(settings.bgReceiptDelayDays);
  const changed =
    valid && JSON.stringify([...normalized].sort((a, b) => a - b)) !== JSON.stringify(savedDays);
  const draftChanged =
    JSON.stringify(days.map((value) => value.trim())) !== JSON.stringify(savedDays.map(String));
  const cancelBgReceiptDelayRef = useRef(() => undefined);
  cancelBgReceiptDelayRef.current = () => {
    setDays(savedDays.map(String));
    setMessage("");
  };

  useEffect(() => {
    if (!draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelBgReceiptDelayRef.current(),
    });
    return () => draft.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setLocalDirty?.(draftChanged);
  }, [draft?.setLocalDirty, draftChanged]);

  const save = async (nextDays = normalized) => {
    const sorted = [...nextDays].sort((left, right) => left - right);
    if (
      !sorted.length ||
      sorted.length > 6 ||
      sorted.some((value) => !Number.isInteger(value) || value < 0) ||
      new Set(sorted).size !== sorted.length
    ) {
      setMessage("Enter distinct, non-negative whole-number thresholds.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await store.saveSettings({ bgReceiptDelayDays: sorted });
      setDays(sorted.map(String));
      setMessage("BG receipt-delay thresholds saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save thresholds.");
    } finally {
      setSaving(false);
    }
  };

  if (activeUser?.role !== "admin") {
    return (
      <div className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
        Only administrators can change the shared BG receipt-delay thresholds.
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">BG receipt-delay thresholds</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to Reports &gt; BG receipt delay for all users. Defaults: 10, 30, and 60 days.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {days.map((value, index) => (
          <label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Threshold {index + 1} (days)</span>
            <ClearableInput
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(event) => {
                setDays((current) =>
                  current.map((day, dayIndex) => (dayIndex === index ? event.target.value : day)),
                );
                setMessage("");
              }}
              onClear={() => {
                setDays((current) => current.map((day, dayIndex) => (dayIndex === index ? "" : day)));
                setMessage("");
              }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground" role="status">
          {message}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving || days.length >= 6}
            onClick={() =>
              setDays((current) => [...current, String((Number(current.at(-1)) || 0) + 30)])
            }
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Add threshold
          </button>
          <DeleteConfirmation
            mode="draft"
            onConfirm={() => setDays((current) => current.slice(0, -1))}
          >
            <button
              type="button"
              disabled={saving || days.length <= 1}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Remove last
            </button>
          </DeleteConfirmation>
          <button
            type="button"
            disabled={saving || !changed}
            onClick={() => void save()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="size-3.5" /> Save
          </button>
          <button
            type="button"
            disabled={saving || !draftChanged}
            onClick={() => cancelBgReceiptDelayRef.current()}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              saving || JSON.stringify(savedDays) === JSON.stringify(defaultBgReceiptDelayDays)
            }
            onClick={() => {
              setDays(defaultBgReceiptDelayDays.map(String));
              void save(defaultBgReceiptDelayDays);
            }}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Reset defaults
          </button>
        </div>
      </div>
      {!valid ? (
        <p className="mt-2 text-xs text-destructive">
          Thresholds must be distinct, non-negative whole numbers.
        </p>
      ) : null}
    </section>
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
  const [loading, setLoading] = useState(false);
  const [loadedYear, setLoadedYear] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const loadRequestRef = useRef(0);
  const [workflowTab, setWorkflowTab] = useState<
    "current" | "sent" | "fileAccepted" | "universalAccepted" | "rejected" | "revoked"
  >("current");
  const [selectedDecisionSignatures, setSelectedDecisionSignatures] = useState<string[]>([]);
  const settings = useSettings();

  const load = async () => {
    const requestId = ++loadRequestRef.current;
    const requestedYear = settings.selectedYear;
    setLoading(true);
    setLoadedYear(null);
    setAcceptances([]);
    setActiveAnomalies([]);
    setSelectedDecisionSignatures([]);
    setLoadError("");
    setMessage("");
    try {
      const [acceptancePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        store.listSuspectedAnomalies(requestedYear),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setAcceptances(acceptancePayload.acceptances);
      setActiveAnomalies(anomalyPayload.rows);
      setLoadedYear(requestedYear);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      console.error(error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load anomaly control.";
      setAcceptances([]);
      setActiveAnomalies([]);
      setLoadedYear(null);
      setLoadError(errorMessage);
      setMessage(errorMessage);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [settings.selectedYear]);

  const resultsReady = !loading && !loadError && loadedYear === settings.selectedYear;

  const anomalySummary = (row: AnomalyAcceptanceRow) => ({
    title: row.ruleLabel || humanizeSettingsAnomalyLabel(row.ruleKey) || "Anomaly exception",
    detail:
      row.previousField || row.laterField
        ? `${row.previousField || "Earlier value"}: ${row.previousValue || "-"}; ${row.laterField || "Recorded value"}: ${row.laterValue || "-"}`
        : row.context
          ? `Context: ${row.context}`
          : "",
  });
  const formatStatus = (status: string) =>
    status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const formatScope = (scope: string | undefined) => (scope === "universal" ? "Universal" : "File");

  const review = async (signature: string, action: string) => {
    if (!resultsReady) return;
    const adminMessage =
      action === "reject"
        ? await showAppPrompt("Correction message to User explaining what should be fixed:", {
            title: "Correction message",
            inputLabel: "Message",
          })
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
    if (!resultsReady || !signatures.length) return;
    const password = await promptPassword(
      "Enter your account password to clear selected anomalies:",
    );
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

  const displayedActiveAnomalies = resultsReady ? activeAnomalies : [];
  const displayedAcceptances = resultsReady ? acceptances : [];
  const currentAnomalies = displayedActiveAnomalies.filter(
    (row) => row.requestStatus !== "pending",
  );
  const sentAnomalies = displayedActiveAnomalies.filter((row) => row.requestStatus === "pending");
  const fileAcceptedAnomalies = displayedAcceptances.filter(
    (row) => row.status === "approved_file",
  );
  const universalAcceptedAnomalies = displayedAcceptances.filter(
    (row) => row.status === "approved_universal",
  );
  const rejectedAnomalies = displayedAcceptances.filter((row) => row.status === "rejected");
  const revokedAnomalies = displayedAcceptances.filter((row) => row.status === "revoked");
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
  const currentGroups = groupActive(currentAnomalies);
  const sentGroups = groupActive(sentAnomalies);
  const decisionGroups = groupHistory(decisionAnomalies);
  const currentRowNumberBySignature = new Map(
    currentGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
  const sentRowNumberBySignature = new Map(
    sentGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
  const decisionRowNumberBySignature = new Map(
    decisionGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
  const toggleDecisionSignature = (signature: string) => {
    if (!resultsReady) return;
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
  const renderActiveAnomalyGroups = (rows: SuspectedAnomalyRow[]) => {
    if (!rows.length)
      return <p className="text-xs text-muted-foreground">No anomalies in this tab.</p>;
    return (
      <div className="space-y-3">
        {(workflowTab === "sent" ? sentGroups : currentGroups).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/50 px-3 py-2">
              <h4 className="text-sm font-semibold">{group.title}</h4>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div
                  key={row.signature}
                  className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[3rem_1.2fr_2fr_1.6fr]"
                >
                  <div className="font-semibold text-muted-foreground">
                    {workflowTab === "sent"
                      ? sentRowNumberBySignature.get(row.signature)
                      : currentRowNumberBySignature.get(row.signature)}
                  </div>
                  <div>
                    <span className="font-semibold">{row.fileRef}</span>
                    <span className="mt-1 block text-muted-foreground">{row.division || "-"}</span>
                    <span className="block text-muted-foreground">{row.block}</span>
                  </div>
                  <div>
                    <div>
                      {row.previousField ? `${row.previousField}: ` : ""}
                      {row.previousDate || "-"}
                    </div>
                    <div>
                      {row.laterField ? `${row.laterField}: ` : ""}
                      {row.laterDate || "-"}
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
                        disabled={!resultsReady}
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
                        disabled={!resultsReady}
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
                        disabled={!resultsReady}
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
        {decisionGroups.map((group) => (
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
                    className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[3rem_1.1fr_2fr_1fr_1fr]"
                  >
                    <div className="font-semibold text-muted-foreground">
                      {decisionRowNumberBySignature.get(row.signature)}
                    </div>
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
                      <div className="text-muted-foreground">{formatScope(row.scope)} decision</div>
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
                            disabled={!resultsReady}
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
                            disabled={!resultsReady}
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
        <p className="text-xs leading-5 text-muted-foreground">
          Review user acceptance requests and approve file-specific or universal exceptions.
        </p>
      </div>
      {message ? (
        <p
          role={loadError ? "alert" : "status"}
          className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs"
        >
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
          <HelpedControl
            helper={settingsControlHelpers.anomalyRefresh}
            label="Refresh anomaly help"
          >
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
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
              disabled={!resultsReady}
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
                disabled={!resultsReady}
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
    </div>
  );
}

function MilestoneSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const milestones = appendFileClosedMilestone(
    settings.milestones && settings.milestones.length > 0
      ? settings.milestones
      : defaultMilestoneSequence,
  );
  const milestoneUsage = getMilestoneUsage(files);
  const configuredRows = getMasterValueUsageRows(milestones, milestoneUsage);
  const protectedMilestoneKeys = useMemo(
    () => new Set(defaultMilestoneSequence.map(normalizeMilestoneName)),
    [],
  );
  const activeKeys = new Set(milestones.map(normalizeMilestoneName));
  const configuredKeys = new Set(configuredRows.map((row) => normalizeMilestoneName(row.value)));
  const defaultInactiveRows = defaultMilestoneSequence
    .filter((milestone) => !activeKeys.has(normalizeMilestoneName(milestone)))
    .filter((milestone) => !configuredKeys.has(normalizeMilestoneName(milestone)))
    .map((milestone) => ({
      value: milestone,
      usageCount: milestoneUsage.get(normalizeMilestoneName(milestone))?.fileIds.size ?? 0,
      status: "inactive" as const,
    }));
  const rows = [...configuredRows, ...defaultInactiveRows];
  const [position, setPosition] = useState(String(milestones.length + 1));

  if (activeUser && !canViewAdminSettings(activeUser.role)) return null;

  const updateMilestones = (next: string[]) => {
    updateSettings({ milestones: next });
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

  const activate = (milestone: string) => {
    const exists = milestones.some((item) => item.toLowerCase() === milestone.toLowerCase());
    if (!exists) updateMilestones([...milestones, milestone]);
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= milestones.length) return;
    if (
      normalizeMilestoneName(milestones[index]) === normalizeMilestoneName(fileClosedMilestone) ||
      normalizeMilestoneName(milestones[nextIndex]) === normalizeMilestoneName(fileClosedMilestone)
    ) {
      return;
    }
    const next = [...milestones];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateMilestones(next);
  };

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-1 inline-flex items-center gap-1.5">
        <h2 className="text-sm font-semibold">Milestones</h2>
        <SettingsHelper
          items={settingsSectionHelpers.milestones}
          label="Milestones help"
          sectionOrder={milestoneHelperSectionOrder}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Controls the active milestone order on file boards and in Dashboard Status-2 and Status-4. Usage includes current and completed milestones on files, S.O.s, delivery stages, and advance payments.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_170px_auto] md:items-end">
        <label className="block min-w-0">
          <div className="text-xs font-medium mb-1.5">Milestone</div>
          <DivisionInput value={name} onChange={setName} placeholder="Milestone name" />
        </label>
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
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No milestone names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const milestone = row.value;
              const activeIndex = milestones.findIndex(
                (item) => item.toLowerCase() === milestone.toLowerCase(),
              );
              const active = row.status === "active";
              const isFileClosed =
                normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone);
              return (
                <li key={milestone} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-secondary text-xs font-semibold">
                      {active ? activeIndex + 1 : "-"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{milestone}</span>
                      <MasterValueMeta row={row} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {active ? (
                      <>
                        <button
                          type="button"
                          onClick={() => move(activeIndex, -1)}
                          disabled={activeIndex === 0 || isFileClosed}
                          className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                          aria-label={`Move ${milestone} up`}
                          title={isFileClosed ? "File Closed is always kept last" : undefined}
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(activeIndex, 1)}
                          disabled={
                            activeIndex === milestones.length - 1 ||
                            isFileClosed ||
                            activeIndex === milestones.length - 2
                          }
                          className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                          aria-label={`Move ${milestone} down`}
                          title={
                            isFileClosed || activeIndex === milestones.length - 2
                              ? "File Closed is always kept last"
                              : undefined
                          }
                        >
                          <ArrowDown className="size-4" />
                        </button>
                      </>
                    ) : null}
                    {protectedMilestoneKeys.has(normalizeMilestoneName(milestone)) ? (
                      active ? (
                        <MasterValueActions
                          row={row}
                          onActivate={() => activate(milestone)}
                          onDeactivate={() => remove(milestone)}
                          onDelete={() => undefined}
                          label={milestone}
                        />
                      ) : (
                        <MasterValueActions
                          row={row}
                          onActivate={() => activate(milestone)}
                          onDeactivate={() => undefined}
                          onDelete={() => undefined}
                          label={milestone}
                        />
                      )
                    ) : active ? (
                      <MasterValueActions
                        row={row}
                        onActivate={() => activate(milestone)}
                        onDeactivate={() => remove(milestone)}
                        onDelete={() => remove(milestone)}
                        label={milestone}
                      />
                    ) : (
                      <MasterValueActions
                        row={row}
                        onActivate={() => activate(milestone)}
                        onDeactivate={() => undefined}
                        onDelete={() => undefined}
                        label={milestone}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function TableFieldPresetSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
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
    updateSettings({ tableFieldPresets: next });
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">Preset table fields</h2>
            <SettingsHelper
              items={settingsSectionHelpers.presets}
              label="Preset table fields help"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Shared presets are set by admin and visible to all. Add personal presets visible only to
            the account that created them.
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
                      <span className="rounded bg-background/80 px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">
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
                  <ClearableInput
                    value={selectedPreset.name}
                    onChange={(event) => updateSelectedPreset({ name: event.target.value })}
                    onClear={() => updateSelectedPreset({ name: "" })}
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
                  <DeleteConfirmation mode="draft" onConfirm={removePreset}>
                    <button
                      type="button"
                      disabled={!selectedPresetEditable}
                      className="h-10 rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </DeleteConfirmation>
                </HelpedControl>
              </div>
              {!selectedPresetEditable ? (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  This shared preset is managed by Admin. Add a personal preset to create an
                  editable version.
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
  const updateSettings = useSettingsUpdater();
  const draft = useContext(SettingsDraftContext);
  const savedSettings = useStoreSettings();
  const savedPresetDraftSignature = JSON.stringify(savedSettings.demandProcessingPresets ?? []);
  const [presetDraft, setPresetDraft] = useState(() =>
    readDemandProcessingPresetDraft(savedSettings.demandProcessingPresets),
  );
  const [presetMessage, setPresetMessage] = useState("");
  const presets = presetDraft;
  const dayRanges = normalizeDemandProcessingDayRanges(settings.demandProcessingDayRanges);
  const dayRangesSignature = JSON.stringify(dayRanges);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "");
  const [dayRangeDraft, setDayRangeDraft] = useState(dayRanges);
  const [dayRangeMessage, setDayRangeMessage] = useState("");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const savedPresets = readDemandProcessingPresetDraft(savedSettings.demandProcessingPresets);
  const presetDraftDirty = !isSettingsDirtyValueEqual(presetDraft, savedPresets);
  const dayRangeDraftDirty = !isSettingsDirtyValueEqual(dayRangeDraft, dayRanges);
  const syncedPresetSignatureRef = useRef(savedPresetDraftSignature);
  const syncedDayRangesSignatureRef = useRef(dayRangesSignature);
  const cancelPresetDraftRef = useRef(() => undefined);
  const savePresetDraftRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelDayRangeDraftRef = useRef(() => undefined);
  cancelPresetDraftRef.current = () => {
    const next = readDemandProcessingPresetDraft(savedSettings.demandProcessingPresets);
    setPresetDraft(next);
    setSelectedPresetId((current) =>
      next.some((preset) => preset.id === current) ? current : (next[0]?.id ?? ""),
    );
    setPresetMessage("");
  };
  cancelDayRangeDraftRef.current = () => {
    setDayRangeDraft(normalizeDemandProcessingDayRanges(savedSettings.demandProcessingDayRanges));
    setDayRangeMessage("");
  };

  useEffect(() => {
    if (syncedPresetSignatureRef.current === savedPresetDraftSignature) return;
    syncedPresetSignatureRef.current = savedPresetDraftSignature;
    const next = readDemandProcessingPresetDraft(savedSettings.demandProcessingPresets);
    setPresetDraft(next);
    setSelectedPresetId((current) =>
      next.some((preset) => preset.id === current) ? current : (next[0]?.id ?? ""),
    );
    setPresetMessage("");
  }, [savedPresetDraftSignature, savedSettings.demandProcessingPresets]);

  useEffect(() => {
    if (!selectedPreset && presets[0]) setSelectedPresetId(presets[0].id);
  }, [presets, selectedPreset]);

  useEffect(() => {
    if (syncedDayRangesSignatureRef.current === dayRangesSignature) return;
    syncedDayRangesSignatureRef.current = dayRangesSignature;
    setDayRangeDraft(JSON.parse(dayRangesSignature) as DemandProcessingDayRange[]);
    setDayRangeMessage("");
  }, [dayRangesSignature]);

  useEffect(() => {
    if (!draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: () => savePresetDraftRef.current(),
      cancel: () => {
        cancelPresetDraftRef.current();
        cancelDayRangeDraftRef.current();
      },
    });
    return () => draft.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setExternalDirty?.(presetDraftDirty);
  }, [draft?.setExternalDirty, presetDraftDirty]);

  useEffect(() => {
    draft?.setLocalDirty?.(dayRangeDraftDirty);
  }, [draft?.setLocalDirty, dayRangeDraftDirty]);

  const updatePresets = (next: DemandProcessingPreset[]) => {
    setPresetDraft(next);
    setPresetMessage("");
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

  const savePresetDraft = async () => {
    const validationMessage = validateDemandProcessingPresetDraft(presetDraft);
    if (validationMessage) {
      setPresetMessage(validationMessage);
      throw new Error(validationMessage);
    }
    const normalized = normalizeDemandProcessingPresetDraft(presetDraft);
    setPresetMessage("");
    try {
      await store.saveSettings({ demandProcessingPresets: normalized });
      setPresetDraft(normalized);
      setPresetMessage("Demand processing presets saved.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Demand processing presets could not be saved.";
      setPresetMessage(message);
      throw error;
    }
  };
  savePresetDraftRef.current = savePresetDraft;
  const updateDayRange = (id: string, patch: Partial<DemandProcessingDayRange>) => {
    setDayRangeDraft((current) =>
      current.map((range) => (range.id === id ? { ...range, ...patch } : range)),
    );
    setDayRangeMessage("");
  };
  const addDayRange = () => {
    const lastRange = dayRangeDraft[dayRangeDraft.length - 1];
    if (!lastRange) {
      setDayRangeMessage("Add at least one range before continuing.");
      return;
    }
    const lastMaxText = String(lastRange.maxDays ?? "").trim();
    if (!lastMaxText) {
      const lastMinText = String(lastRange.minDays ?? "").trim();
      const lastMin = Number(lastMinText);
      if (!lastMinText || !Number.isInteger(lastMin) || lastMin < 0) {
        setDayRangeMessage("Enter a valid minimum for the last range before adding another.");
        return;
      }
      const nextMax = lastMin + 89;
      const nextMin = nextMax + 1;
      const hasGeneratedOpenLabel = /^\d+\s+and above$/i.test(lastRange.label.trim());
      setDayRangeDraft([
        ...dayRangeDraft.slice(0, -1),
        {
          ...lastRange,
          label: hasGeneratedOpenLabel ? `${lastMin}-${nextMax}` : lastRange.label,
          maxDays: String(nextMax),
        },
        {
          id: crypto.randomUUID(),
          label: `${nextMin} and above`,
          minDays: String(nextMin),
          maxDays: "",
        },
      ]);
    } else {
      const lastMax = Number(lastMaxText);
      if (!Number.isInteger(lastMax) || lastMax < 0) {
        setDayRangeMessage("Enter a valid maximum for the last range before adding another.");
        return;
      }
      const nextMin = lastMax + 1;
      setDayRangeDraft([
        ...dayRangeDraft,
        {
          id: crypto.randomUUID(),
          label: `${nextMin} and above`,
          minDays: String(nextMin),
          maxDays: "",
        },
      ]);
    }
    setDayRangeMessage("");
  };
  const removeDayRange = (id: string) => {
    if (dayRangeDraft.length <= 1) {
      setDayRangeMessage("At least one day range is required.");
      return;
    }
    setDayRangeDraft((current) => current.filter((range) => range.id !== id));
    setDayRangeMessage("");
  };
  const resetDayRanges = () => {
    setDayRangeDraft(defaultDemandProcessingDayRanges.map((range) => ({ ...range })));
    setDayRangeMessage("");
  };
  const discardDayRangeChanges = () => {
    setDayRangeDraft(dayRanges);
    setDayRangeMessage("");
  };
  const applyDayRanges = () => {
    const message = validateDemandProcessingDayRanges(dayRangeDraft);
    setDayRangeMessage(message);
    if (message) return;
    const normalized = normalizeDemandProcessingDayRanges(dayRangeDraft);
    updateSettings({ demandProcessingDayRanges: normalized });
    setDayRangeDraft(normalized);
  };

  return (
    <div className="space-y-4">
      <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold mb-1">Demand Processing Analysis Presets</h2>
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
                        <span className="rounded bg-background/80 px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">
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
                    <ClearableInput
                      value={selectedPreset.name}
                      onChange={(event) => updateSelectedPreset({ name: event.target.value })}
                      onClear={() => updateSelectedPreset({ name: "" })}
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
                    <DeleteConfirmation mode="draft" onConfirm={removePreset}>
                      <button
                        type="button"
                        className="h-10 self-end rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </DeleteConfirmation>
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
                {presetMessage ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {presetMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <DemandProcessingDayRangeSettings
        ranges={dayRangeDraft}
        message={dayRangeMessage}
        dirty={dayRangeDraftDirty}
        onAdd={addDayRange}
        onApply={applyDayRanges}
        onDiscard={discardDayRangeChanges}
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

function readDemandProcessingPresetDraft(value: unknown): DemandProcessingPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    if (!id) return [];
    return [
      {
        id,
        name: String(record.name ?? ""),
        fromFieldId: String(record.fromFieldId ?? "").trim(),
        toFieldId: String(record.toFieldId ?? "").trim(),
        active: record.active !== false,
      },
    ];
  });
}

function normalizeDemandProcessingPresetDraft(presets: DemandProcessingPreset[]) {
  return presets.map((preset) => ({
    id: preset.id.trim(),
    name: preset.name.trim(),
    fromFieldId: preset.fromFieldId.trim(),
    toFieldId: preset.toFieldId.trim(),
    active: preset.active !== false,
  }));
}

function validateDemandProcessingPresetDraft(presets: DemandProcessingPreset[]) {
  const ids = new Set<string>();
  for (const [index, preset] of presets.entries()) {
    const label = `Preset ${index + 1}`;
    const id = preset.id.trim();
    const name = preset.name.trim();
    if (!id) return `${label} needs an id.`;
    if (ids.has(id)) return `${label} has a duplicate id.`;
    ids.add(id);
    if (!name) return `${label} needs a name.`;
    if (!getDemandProcessingField(preset.fromFieldId.trim())) {
      return `${name}: choose a valid From date.`;
    }
    if (!getDemandProcessingField(preset.toFieldId.trim())) {
      return `${name}: choose a valid To date.`;
    }
  }
  return "";
}

const defaultDemandProcessingDayRanges: DemandProcessingDayRange[] = [
  { id: "0-90", label: "0-90", minDays: "0", maxDays: "90" },
  { id: "91-180", label: "91-180", minDays: "91", maxDays: "180" },
  { id: "181-365", label: "181-365", minDays: "181", maxDays: "365" },
  { id: "365-plus", label: "366 and above", minDays: "366", maxDays: "" },
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
    .filter((range): range is NonNullable<typeof range> => range !== undefined);
  return ranges.length ? ranges : defaultDemandProcessingDayRanges;
}

function validateDemandProcessingDayRanges(ranges: DemandProcessingDayRange[]) {
  if (ranges.length === 0) return "At least one day range is required.";
  const parsed = ranges.map((range) => {
    const label = range.label.trim();
    const minText = String(range.minDays ?? "").trim();
    const maxText = String(range.maxDays ?? "").trim();
    const min = Number(minText);
    const max = maxText ? Number(maxText) : undefined;
    if (!label) return { error: "Each day range needs a label." };
    if (!minText || !Number.isInteger(min) || min < 0) {
      return { error: `${label}: minimum days must be a non-negative whole number.` };
    }
    if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
      return { error: `${label}: maximum days must be a non-negative whole number.` };
    }
    return { label, min, max };
  });
  const invalid = parsed.find((range): range is { error: string } => "error" in range);
  if (invalid) return invalid.error;
  return validateRangeContinuity(
    parsed.filter(
      (range): range is { label: string; min: number; max?: number } => !("error" in range),
    ),
    1,
  );
}

function DemandProcessingDayRangeSettings({
  ranges,
  message,
  dirty,
  onAdd,
  onApply,
  onDiscard,
  onReset,
  onUpdate,
  onRemove,
}: {
  ranges: DemandProcessingDayRange[];
  message?: string;
  dirty: boolean;
  onAdd: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onReset: () => void;
  onUpdate: (id: string, patch: Partial<DemandProcessingDayRange>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">Demand processing day ranges</h2>
            <SettingsHelper
              items={settingsControlHelpers.demandProcessingDayRanges}
              label="Demand processing day ranges help"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            These ranges group results in Reports &gt; Demand processing analysis. Edits stay local
            until applied; then use Save changes above to save them.
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
          {dirty ? (
            <button
              type="button"
              onClick={onDiscard}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
            >
              Discard edits
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAdd}
            className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add range
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty}
            className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply ranges
          </button>
        </div>
      </div>
      {message ? (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message}
        </p>
      ) : null}
      <div className="space-y-2">
        {ranges.map((range) => (
          <div
            key={range.id}
            className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,180px)_auto] md:items-end"
          >
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>Label</span>
              <ClearableInput
                value={range.label}
                onChange={(event) => onUpdate(range.id ?? "", { label: event.target.value })}
                onClear={() => onUpdate(range.id ?? "", { label: "" })}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>Min days</span>
              <ClearableInput
                type="number"
                value={range.minDays ?? ""}
                onChange={(event) => onUpdate(range.id ?? "", { minDays: event.target.value })}
                onClear={() => onUpdate(range.id ?? "", { minDays: "" })}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>Max days</span>
              <ClearableInput
                type="number"
                value={range.maxDays ?? ""}
                onChange={(event) => onUpdate(range.id ?? "", { maxDays: event.target.value })}
                onClear={() => onUpdate(range.id ?? "", { maxDays: "" })}
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <div className="flex items-end">
              <HelpedControl
                helper={settingsControlHelpers.genericDelete}
                label="Delete day range help"
              >
                <DeleteConfirmation mode="draft" onConfirm={() => onRemove(range.id ?? "")}>
                  <button
                    type="button"
                    className="h-9 w-full rounded-md border border-destructive/40 bg-background px-2 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                </DeleteConfirmation>
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
  const updateSettings = useSettingsUpdater();
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
    updateSettings({ mmgSummaryFields: nextFields });
  };

  const updateField = (key: string, patch: Partial<(typeof fields)[number]>) => {
    updateFields(fields.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  };

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">MMG Summary</h2>
            <SettingsHelper items={settingsSectionHelpers.mmgSummary} label="MMG Summary help" />
          </div>
          <p className="text-xs text-muted-foreground">
            Choose the rows and labels shown in Reports &gt; MMG Summary and its exports.
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
                        <span className="mb-1 block">Display and export label</span>
                        <ClearableInput
                          value={field.label}
                          onChange={(event) =>
                            updateField(option.key, { label: event.target.value })
                          }
                          onClear={() => updateField(option.key, { label: "" })}
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
  const draft = useContext(SettingsDraftContext);
  const divisions = useDivisions();
  const files = useSettingsUsageFiles();
  const divisionUsage = getDivisionUsage(files);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editMessagesEnabled, setEditMessagesEnabled] = useState(true);
  const [editViewerPassword, setEditViewerPassword] = useState("");

  const add = () => {
    if (!name.trim()) return;
    void store.addDivision(name.trim(), code.trim() || undefined).catch((error) => {
      console.error(error);
    });
    setName("");
    setCode("");
  };

  const startEdit = (division: (typeof divisions)[number]) => {
    setEditingId(division.id);
    setEditName(division.name);
    setEditCode(division.code ?? "");
    setEditMessagesEnabled(division.messagesEnabled !== false);
    setEditViewerPassword("");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    store.updateDivision(id, {
      name: editName.trim(),
      code: editCode.trim() || undefined,
      messagesEnabled: editMessagesEnabled,
      ...(editViewerPassword.trim() ? { viewerPassword: editViewerPassword.trim() } : {}),
    });
    setEditingId(null);
  };

  const divisionDraftDirty = Boolean(name.trim() || code.trim() || editingId);
  const cancelDivisionDraftsRef = useRef(() => undefined);
  cancelDivisionDraftsRef.current = () => {
    setName("");
    setCode("");
    setEditingId(null);
    setEditName("");
    setEditCode("");
    setEditViewerPassword("");
  };

  useEffect(() => {
    if (!draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelDivisionDraftsRef.current(),
    });
    return () => draft.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setLocalDirty?.(divisionDraftDirty);
  }, [draft?.setLocalDirty, divisionDraftDirty]);

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Divisions</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Rename only to correct the division name; linked records will show the updated name. Delete
        is available only when no files use the division.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="Division name" />
        <DivisionInput value={code} onChange={setCode} placeholder="Division code" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={add}
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add
          </button>
          {name.trim() || code.trim() ? (
            <button
              type="button"
              onClick={() => cancelDivisionDraftsRef.current()}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[20%]" />
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Division name</th>
              <th className="text-left font-medium px-4 py-2.5">Division code</th>
              <th className="text-left font-medium px-4 py-2.5">Messages</th>
              <th className="text-left font-medium px-4 py-2.5">Viewer password</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((division) => {
              const isEditing = editingId === division.id;
              const usageCount = getDivisionUsageCount(division, divisionUsage);
              const editChanged =
                editName.trim() !== division.name ||
                editCode.trim() !== (division.code ?? "") ||
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
                  <td className="break-words px-3 py-3 text-muted-foreground">
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
                      <PasswordInput
                        value={editViewerPassword}
                        onChange={(event) => setEditViewerPassword(event.target.value)}
                        placeholder="New viewer password"
                        autoComplete="new-password"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
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
                          {usageCount > 0 ? (
                            <button
                              type="button"
                              disabled
                              title={`Used in ${usageCount} file${usageCount === 1 ? "" : "s"}, including Archive. Historical references are protected.`}
                              aria-label={`Cannot delete ${division.name}; it is used in file history`}
                              className="size-8 grid place-items-center rounded-md text-muted-foreground opacity-60"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          ) : (
                            <HelpedControl
                              helper={settingsControlHelpers.archiveEntity}
                              label={`Archive ${division.name} help`}
                            >
                              <DeleteConfirmation
                                mode="archive"
                                onConfirm={async () => {
                                  if (
                                    await requestDeletionPassword(
                                      `archive division "${division.name}"`,
                                    )
                                  ) {
                                    await store.deleteDivision(division.id);
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </DeleteConfirmation>
                            </HelpedControl>
                          )}
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
  | "firmName"
  | "firmType"
  | "firmTypeOther"
  | "emailId"
  | "city"
  | "address"
  | "firmUniqueNo"
  | "contactNo"
>;

const emptyFirmDraft: FirmDraft = {
  firmName: "",
  firmType: "",
  firmTypeOther: "",
  emailId: "",
  city: "",
  address: "",
  firmUniqueNo: "",
  contactNo: "",
};

function cleanFirmDraft(draft: FirmDraft): FirmDraft {
  return {
    firmName: draft.firmName?.trim() || "",
    firmType: draft.firmType?.trim() || "",
    firmTypeOther:
      draft.firmType?.trim().toUpperCase() === "OTHER" ? draft.firmTypeOther?.trim() || "" : "",
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

function readFirmRatingDraft(config?: FirmRatingConfig): FirmRatingConfig["fields"] {
  const source = config?.fields?.length ? config.fields : defaultFirmRatingFields;
  return source.map((field, index) => ({
    id: field.id?.trim() || `rating${index + 1}`,
    label: field.label ?? "",
    weight: field.weight ?? "",
    minValue: field.minValue ?? "",
    maxValue: field.maxValue ?? "",
  }));
}

function validateFirmRatingDraft(fields: FirmRatingConfig["fields"]) {
  if (!fields.length) return "At least one firm rating field is required.";
  const ids = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const label = field.label.trim() || `Rating ${index + 1}`;
    const id = field.id.trim();
    if (!id || ids.has(id)) return `${label}: field IDs must be unique.`;
    ids.add(id);
    const weightText = field.weight?.trim() ?? "";
    if (weightText) {
      const weight = Number(weightText);
      if (!Number.isFinite(weight) || weight <= 0) {
        return `${label}: weight must be greater than zero.`;
      }
    }
    const minText = field.minValue?.trim() ?? "";
    const maxText = field.maxValue?.trim() ?? "";
    const min = minText ? Number(minText) : 0;
    const max = maxText ? Number(maxText) : 5;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return `${label}: minimum and maximum values must be numbers.`;
    }
    if (min > max) return `${label}: minimum cannot exceed maximum.`;
  }
  return "";
}

function FirmRatingSettings() {
  const draft = useContext(SettingsDraftContext);
  const savedSettings = useStoreSettings();
  const savedConfigSignature = JSON.stringify(savedSettings.firmRatingConfig ?? null);
  const [fields, setFields] = useState<FirmRatingConfig["fields"]>(() =>
    readFirmRatingDraft(savedSettings.firmRatingConfig),
  );
  const [message, setMessage] = useState("");
  const savedFields = readFirmRatingDraft(savedSettings.firmRatingConfig);
  const fieldsDirty = !isSettingsDirtyValueEqual(fields, savedFields);
  const syncedConfigSignatureRef = useRef(savedConfigSignature);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelRef = useRef(() => undefined);

  cancelRef.current = () => {
    setFields(readFirmRatingDraft(savedSettings.firmRatingConfig));
    setMessage("");
  };

  useEffect(() => {
    if (syncedConfigSignatureRef.current === savedConfigSignature) return;
    syncedConfigSignatureRef.current = savedConfigSignature;
    setFields(readFirmRatingDraft(savedSettings.firmRatingConfig));
    setMessage("");
  }, [savedConfigSignature, savedSettings.firmRatingConfig]);

  useEffect(() => {
    if (!draft?.registerExternalDraft) return;
    draft.registerExternalDraft({
      save: () => saveRef.current(),
      cancel: () => cancelRef.current(),
    });
    return () => draft.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setExternalDirty?.(fieldsDirty);
  }, [draft?.setExternalDirty, fieldsDirty]);

  const updateFields = (nextFields: FirmRatingConfig["fields"]) => {
    setFields(nextFields);
    setMessage("");
  };

  const updateField = (index: number, patch: Partial<FirmRatingConfig["fields"][number]>) => {
    updateFields(
      fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    );
  };

  const addField = () => {
    updateFields([
      ...fields,
      {
        id: createFirmRatingFieldId(fields),
        label: `Rating ${fields.length + 1}`,
        weight: "1",
        minValue: "0",
        maxValue: "5",
      },
    ]);
  };

  const removeField = (index: number) => {
    updateFields(fields.filter((_field, fieldIndex) => fieldIndex !== index));
  };

  const resetFields = () => {
    updateFields(defaultFirmRatingFields);
  };

  const save = async () => {
    const validationMessage = validateFirmRatingDraft(fields);
    if (validationMessage) {
      setMessage(validationMessage);
      throw new Error(validationMessage);
    }
    const normalized = normalizeFirmRatingConfig({ fields });
    setMessage("");
    try {
      await store.saveSettings({ firmRatingConfig: normalized });
      setFields(normalized.fields);
      setMessage("Firm rating settings saved.");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Firm rating settings could not be saved.";
      setMessage(errorMessage);
      throw error;
    }
  };
  saveRef.current = save;

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Firm Rating</h2>
          <p className="text-xs text-muted-foreground">
            Configure the score fields used for every supply order. Final score is the total of
            filled numeric values multiplied by their weights. Each field accepts values within its
            configured range.
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
        {fields.map((field, index) => (
          <div
            key={`${field.id}:${index}`}
            className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[minmax(0,1fr)_100px_120px_120px_auto]"
          >
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Field label</span>
              <ClearableInput
                value={field.label}
                onChange={(event) => updateField(index, { label: event.target.value })}
                onClear={() => updateField(index, { label: "" })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Weight</span>
              <ClearableInput
                type="text"
                inputMode="decimal"
                value={field.weight ?? ""}
                onChange={(event) => updateField(index, { weight: event.target.value })}
                onClear={() => updateField(index, { weight: "" })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Minimum value</span>
              <ClearableInput
                type="text"
                inputMode="decimal"
                value={field.minValue ?? ""}
                onChange={(event) => updateField(index, { minValue: event.target.value })}
                onClear={() => updateField(index, { minValue: "" })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Maximum value</span>
              <ClearableInput
                type="text"
                inputMode="decimal"
                value={field.maxValue ?? ""}
                onChange={(event) => updateField(index, { maxValue: event.target.value })}
                onClear={() => updateField(index, { maxValue: "" })}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <DeleteConfirmation mode="draft" onConfirm={() => removeField(index)}>
              <button
                type="button"
                disabled={fields.length <= 1}
                className="h-9 self-end rounded-md border border-border bg-background px-3 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </DeleteConfirmation>
          </div>
        ))}
      </div>
      {message ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function FirmDatabaseSettings() {
  const draftContext = useContext(SettingsDraftContext);
  const activeUser = useActiveUser();
  const settings = useSettings();
  const files = useSettingsUsageFiles();
  const firmUsage = getFirmUsage(files);
  const canManage =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const canManageFirmTypes = activeUser?.role === "admin" || activeUser?.role === "sub_admin";
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
  const [savingFirmType, setSavingFirmType] = useState(false);
  const firmRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const firmQueryKey = `${search}\u0000${debouncedSearch}\u0000${page}\u0000${pageSize}`;
  const latestFirmQueryKeyRef = useRef(firmQueryKey);
  latestFirmQueryKeyRef.current = firmQueryKey;
  const [labelDraft, setLabelDraft] = useState(settings.firmUniqueNoLabel || "Firm Unique No.");
  const firmUniqueNoLabel = settings.firmUniqueNoLabel || "Firm Unique No.";
  const configuredFirmTypes = normalizeFirmTypes(settings.firmTypes);
  const firmTypeOptions = normalizeFirmTypes([...configuredFirmTypes, "Other"]);
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
    const requestId = (firmRequestRef.current?.id ?? 0) + 1;
    const controller = new AbortController();
    firmRequestRef.current?.controller.abort();
    firmRequestRef.current = { id: requestId, controller };
    const requestKey = firmQueryKey;
    setLoading(true);
    setMessage(undefined);
    fetchMasterFirms({ q: debouncedSearch, page, pageSize, signal: controller.signal })
      .then((result) => {
        if (
          controller.signal.aborted ||
          firmRequestRef.current?.id !== requestId ||
          latestFirmQueryKeyRef.current !== requestKey
        ) {
          return;
        }
        setFirms(result.firms);
        setFirmTotal(result.total);
        if (result.page !== page) setPage(result.page);
        if (result.pageSize !== pageSize) setPageSize(result.pageSize);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          firmRequestRef.current?.id !== requestId ||
          latestFirmQueryKeyRef.current !== requestKey
        ) {
          return;
        }
        console.error(error);
        setMessage(error instanceof Error ? error.message : "Failed to load firms.");
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          firmRequestRef.current?.id === requestId &&
          latestFirmQueryKeyRef.current === requestKey
        ) {
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    loadFirms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page, pageSize]);

  useEffect(() => {
    return () => firmRequestRef.current?.controller.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(firmTotal / pageSize));
  const firstResultNumber = firmTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResultNumber = Math.min(firmTotal, (page - 1) * pageSize + firms.length);
  const isComplete = (value: FirmDraft) => {
    const cleaned = cleanFirmDraft(value);
    return Boolean(cleaned.firmName);
  };

  const updateDraft = (key: keyof FirmDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const updateEditDraft = (key: keyof FirmDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };
  const addFirmType = async (value: string, target: "new" | "edit") => {
    const trimmed = value.trim();
    if (savingFirmType || !canManageFirmTypes || !trimmed) return;
    const existing = firmTypeOptions.find(
      (firmType) => firmType.toLowerCase() === trimmed.toLowerCase(),
    );
    const selected = existing ?? trimmed;
    if (existing) {
      if (target === "new") updateDraft("firmType", selected);
      else updateEditDraft("firmType", selected);
      return;
    }
    setSavingFirmType(true);
    setMessage(undefined);
    try {
      await store.saveSettings({ firmTypes: normalizeFirmTypes([...configuredFirmTypes, trimmed]) });
      if (target === "new") updateDraft("firmType", selected);
      else updateEditDraft("firmType", selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add firm type.");
    } finally {
      setSavingFirmType(false);
    }
  };

  const addFirm = async () => {
    if (savingFirmType) return;
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
      firmType: firm.firmType ?? "",
      firmTypeOther: firm.firmTypeOther ?? "",
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
      setMessage("Firm archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to archive firm.");
      throw error;
    }
  };

  const saveFirmUniqueNoLabel = async () => {
    if (activeUser?.role !== "admin") return;
    await store.saveSettings({ firmUniqueNoLabel: labelDraft.trim() || "Firm Unique No." });
  };

  const firmDraftDirty = Boolean(
    Object.values(draft).some((value) => value.trim()) ||
    editingId ||
    labelDraft.trim() !== firmUniqueNoLabel,
  );
  const cancelFirmDraftsRef = useRef(() => undefined);
  cancelFirmDraftsRef.current = () => {
    setDraft(emptyFirmDraft);
    setEditingId(null);
    setEditDraft(emptyFirmDraft);
    setLabelDraft(firmUniqueNoLabel);
    setMessage(undefined);
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelFirmDraftsRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setLocalDirty?.(firmDraftDirty);
  }, [draftContext?.setLocalDirty, firmDraftDirty]);

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Firm Database</h2>
          <p className="text-xs text-muted-foreground">
            Edit only for same-firm corrections. Delete is available only when no files/S.O.s use
            the firm name or unique number.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Firm name is required. Firm Unique No. and all other firm details are optional.
          </p>
        </div>
        <ClearableInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch("")}
          placeholder={`Search firm, email, ${firmUniqueNoLabel}`}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 sm:max-w-md"
        />
      </div>

      {activeUser?.role === "admin" ? (
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <DivisionInput
              value={labelDraft}
              onChange={setLabelDraft}
              placeholder="Firm Unique No. label"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Changes the label shown for the firm&apos;s unique-number field; it does not save a
              firm record.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveFirmUniqueNoLabel()}
            disabled={!firmUniqueNoLabelChanged}
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-4" /> Save unique-number label
          </button>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_0.85fr_1fr_1fr_0.8fr_0.9fr_0.9fr_auto]">
        <DivisionInput
          value={draft.firmName ?? ""}
          onChange={(value) => updateDraft("firmName", value)}
          placeholder="Firm name *"
        />
        <DivisionInput
          value={draft.firmUniqueNo ?? ""}
          onChange={(value) => updateDraft("firmUniqueNo", value)}
          placeholder={`${firmUniqueNoLabel} (optional)`}
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
        <div className="space-y-2">
          <FirmTypeSelect
            value={draft.firmType ?? ""}
            options={firmTypeOptions}
            onChange={(value) => updateDraft("firmType", value)}
            onAddType={canManageFirmTypes ? (value) => addFirmType(value, "new") : undefined}
          />
          {draft.firmType?.toUpperCase() === "OTHER" ? (
            <FirmInput
              value={draft.firmTypeOther ?? ""}
              onChange={(value) => updateDraft("firmTypeOther", value)}
              placeholder="Specify firm type (optional)"
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void addFirm()}
          disabled={savingFirmType || !canManage || !isComplete(draft)}
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
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1120px] table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Firm name</th>
              <th className="px-4 py-2.5 text-left font-medium">
                {firmUniqueNoLabel} (optional)
              </th>
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-4 py-2.5 text-left font-medium">Address</th>
              <th className="px-4 py-2.5 text-left font-medium">City</th>
              <th className="px-4 py-2.5 text-left font-medium">Contact No.</th>
              <th className="px-4 py-2.5 text-left font-medium">Firm Type</th>
              <th className="px-4 py-2.5 text-left font-medium">Rating</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {firms.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={9}>
                  {loading ? "Loading firms..." : "No firms found."}
                </td>
              </tr>
            ) : (
              firms.map((firm) => {
                const isEditing = editingId === firm.id;
                const usageCount = getFirmUsageCount(firm, firmUsage);
                const editChanged = !isSettingsDirtyValueEqual(cleanFirmDraft(editDraft), {
                  firmName: firm.firmName ?? "",
                  firmType: firm.firmType ?? "",
                  firmTypeOther: firm.firmTypeOther ?? "",
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
                      invalid={isEditing && !editDraft.firmName?.trim()}
                      displayWidth={20}
                    />
                    <FirmCell
                      editing={isEditing}
                      value={isEditing ? editDraft.firmUniqueNo : firm.firmUniqueNo}
                      onChange={(value) => updateEditDraft("firmUniqueNo", value)}
                      placeholder={`${firmUniqueNoLabel} (optional)`}
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
                      displayWidth={26}
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
                    <td className="break-words px-3 py-3 text-muted-foreground">
                      {isEditing ? (
                        <div className="space-y-2">
                          <FirmTypeSelect
                            value={editDraft.firmType ?? ""}
                            options={firmTypeOptions}
                            onChange={(value) => updateEditDraft("firmType", value)}
                            onAddType={
                              canManageFirmTypes ? (value) => addFirmType(value, "edit") : undefined
                            }
                          />
                          {editDraft.firmType?.toUpperCase() === "OTHER" ? (
                            <FirmInput
                              value={editDraft.firmTypeOther ?? ""}
                              onChange={(value) => updateEditDraft("firmTypeOther", value)}
                              placeholder="Specify firm type (optional)"
                            />
                          ) : null}
                        </div>
                      ) : (
                        [
                          firm.firmType,
                          firm.firmType?.toUpperCase() === "OTHER" ? firm.firmTypeOther : "",
                        ]
                          .filter(Boolean)
                          .join(": ") || "Not set"
                      )}
                    </td>
                    <td className="break-words px-3 py-3 text-muted-foreground">
                      {firm.firmRating || "Not rated"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveEdit(firm.id)}
                              disabled={
                                savingFirmType ||
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
                              usageCount > 0 ? (
                                <button
                                  type="button"
                                  disabled
                                  title={`Used in ${usageCount} file${usageCount === 1 ? "" : "s"} including Archive. Keep historical firm reference.`}
                                  className="inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-[0.6875rem] font-medium text-muted-foreground opacity-70"
                                >
                                  Used
                                </button>
                              ) : (
                                <HelpedControl
                                  helper={settingsControlHelpers.archiveEntity}
                                  label={`Archive ${firm.firmName || "firm"} help`}
                                >
                                  <DeleteConfirmation mode="archive" onConfirm={() => removeFirm(firm.id)}>
                                    <button
                                      type="button"
                                      className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="size-4" />
                                    </button>
                                  </DeleteConfirmation>
                                </HelpedControl>
                              )
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
        onPageChange={setPage}
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
  options,
  displayWidth,
  placeholder,
}: {
  editing: boolean;
  value?: string;
  onChange: (value: string) => void;
  type?: string;
  invalid?: boolean;
  options?: string[];
  displayWidth?: number;
  placeholder?: string;
}) {
  return (
    <td className="break-words px-3 py-3 text-muted-foreground">
      {editing ? (
        options ? (
          <FirmTypeSelect value={value ?? ""} options={options} onChange={onChange} />
        ) : (
          <FirmInput
            value={value ?? ""}
            onChange={onChange}
            placeholder={placeholder ?? ""}
            type={type}
            invalid={invalid}
          />
        )
      ) : displayWidth ? (
        <CompactTableText value={value || "Not set"} width={displayWidth} />
      ) : (
        value || "Not set"
      )}
    </td>
  );
}

function FirmTypeSelect({
  value,
  options,
  onChange,
  onAddType,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAddType?: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");
  const values = Array.from(new Set([...options, ...(value ? [value] : [])]));

  const addType = () => {
    const trimmed = newType.trim();
    if (!trimmed || !onAddType) return;
    onAddType(trimmed);
    setNewType("");
    setAdding(false);
  };

  return (
    <div className="space-y-1.5">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">Select Firm Type</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {onAddType ? (
        adding ? (
          <div className="flex items-center gap-1.5">
            <ClearableInput
              autoFocus
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
              onClear={() => setNewType("")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addType();
                }
                if (event.key === "Escape") setAdding(false);
              }}
              placeholder="New firm type"
              aria-label="New firm type"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              type="button"
              onClick={addType}
              disabled={!newType.trim()}
              aria-label="Add firm type"
              title="Add firm type"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewType("");
              }}
              aria-label="Cancel adding firm type"
              title="Cancel"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-xs text-primary hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add firm type
          </button>
        )
      ) : null}
    </div>
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
    <ClearableInput
      value={value}
      type={type}
      inputMode={type === "tel" ? "numeric" : undefined}
      pattern={
        type === "tel" ? "[0-9]*" : type === "email" ? "[^\\s@]+@[^\\s@]+\\.[^\\s@]+" : undefined
      }
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      onClear={() => onChange("")}
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
  onPageChange,
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
  onPageChange: (page: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const pageNumbers = getSettingsPaginationPages(page, totalPages);

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
          onClick={() => onPageChange(1)}
          className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          First
        </button>
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrevious}
          className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
            className={
              "h-8 min-w-8 rounded-md border px-2 font-medium " +
              (pageNumber === page
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent")
            }
          >
            {pageNumber}
          </button>
        ))}
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
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Last
        </button>
      </div>
    </div>
  );
}

function getSettingsPaginationPages(currentPage: number, totalPages: number, maxVisible = 5) {
  const visible = Math.max(1, Math.min(maxVisible, totalPages));
  const half = Math.floor(visible / 2);
  let startPage = Math.max(1, currentPage - half);
  const endPage = Math.min(totalPages, startPage + visible - 1);
  startPage = Math.max(1, endPage - visible + 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
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
  const draftContext = useContext(SettingsDraftContext);
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const files = useSettingsUsageFiles();
  const indentorUsage = getIndentorUsage(files);
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
  const [indentorReloadKey, setIndentorReloadKey] = useState(0);
  const indentorRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const indentorQueryKey = `${divisionFilter}\u0000${search}\u0000${debouncedSearch}\u0000${page}\u0000${pageSize}\u0000${indentorReloadKey}`;
  const latestIndentorQueryKeyRef = useRef(indentorQueryKey);
  latestIndentorQueryKeyRef.current = indentorQueryKey;
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
    const requestId = (indentorRequestRef.current?.id ?? 0) + 1;
    const controller = new AbortController();
    indentorRequestRef.current?.controller.abort();
    indentorRequestRef.current = { id: requestId, controller };
    const requestKey = indentorQueryKey;
    setIndentorsLoading(true);
    setIndentorsError(undefined);
    fetchIndentors({
      divisionId: divisionFilter === "all" ? undefined : divisionFilter,
      q: debouncedSearch,
      page,
      pageSize,
      signal: controller.signal,
    })
      .then((result) => {
        if (
          controller.signal.aborted ||
          indentorRequestRef.current?.id !== requestId ||
          latestIndentorQueryKeyRef.current !== requestKey
        ) {
          return;
        }
        setIndentors(result.indentors);
        setIndentorTotal(result.total);
        if (result.page !== page) setPage(result.page);
        if (result.pageSize !== pageSize) setPageSize(result.pageSize);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          indentorRequestRef.current?.id !== requestId ||
          latestIndentorQueryKeyRef.current !== requestKey
        ) {
          return;
        }
        console.error(error);
        setIndentorsError(error instanceof Error ? error.message : "Failed to load indentors.");
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          indentorRequestRef.current?.id === requestId &&
          latestIndentorQueryKeyRef.current === requestKey
        ) {
          setIndentorsLoading(false);
        }
      });
  };

  useEffect(() => {
    loadIndentors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionFilter, debouncedSearch, page, pageSize, indentorReloadKey]);

  useEffect(() => {
    return () => indentorRequestRef.current?.controller.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(indentorTotal / pageSize));
  const firstResultNumber = indentorTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResultNumber = Math.min(indentorTotal, (page - 1) * pageSize + indentors.length);

  const updateDraft = (key: keyof IndentorDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateEditDraft = (key: keyof IndentorDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };

  const isReadyToSave = (value: IndentorDraft) => Boolean(value.divisionId && value.name.trim());

  const resetDraft = () =>
    setDraft({ ...emptyIndentorDraft, divisionId: availableDivisions[0]?.id ?? "" });

  const addIndentor = async () => {
    if (!isReadyToSave(draft)) return;
    if (
      activeUser?.role === "viewer" &&
      !(await showAppConfirm(
        "Please confirm the division and name are correct. Other details can be completed later by an admin or sub-admin. Once added, a viewer cannot edit or delete this indentor.",
      ))
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
    setIndentorReloadKey((current) => current + 1);
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
    if (!isReadyToSave(editDraft)) return;
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
    setIndentorReloadKey((current) => current + 1);
  };

  const deleteIndentor = async (id: string) => {
    await store.deleteIndentor(id);
    if (indentors.length === 1 && page > 1) {
      setPage((current) => Math.max(1, current - 1));
    } else {
      setIndentorReloadKey((current) => current + 1);
    }
  };

  const indentorDraftDirty = Boolean(
    draft.name.trim() ||
    draft.sfId.trim() ||
    draft.designation.trim() ||
    draft.mobileNo.trim() ||
    draft.landlineNo.trim() ||
    draft.email.trim() ||
    editingId,
  );
  const cancelIndentorDraftsRef = useRef(() => undefined);
  cancelIndentorDraftsRef.current = () => {
    resetDraft();
    setEditingId(null);
    setEditDraft(emptyIndentorDraft);
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelIndentorDraftsRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setLocalDirty?.(indentorDraftDirty);
  }, [draftContext?.setLocalDirty, indentorDraftDirty]);

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Indentors</h2>
          <p className="text-xs text-muted-foreground">
            Add and search division-wise indentors used when files are created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Division and Name are required. Other details may be left blank and completed later by
            an admin or sub-admin.
          </p>
          <p className="mt-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Editing changes the indentor master record only. Existing file records keep the indentor
            name and division saved on them.
          </p>
        </div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:max-w-2xl sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SearchableDropdown
            value={divisionFilter}
            onChange={(value) => {
              setDivisionFilter(value || "all");
              setPage(1);
            }}
            options={[]}
            optionItems={[
              { value: "all", label: "All divisions" },
              ...availableDivisions.map((division) => ({
                value: division.id,
                label: division.name,
              })),
            ]}
            placeholder="All divisions"
            deferChangeUntilSelect
            allowCustomValue={false}
            containerClassName="min-w-0 w-full"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <ClearableInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search name, SF ID, designation, email"
            className="h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addIndentor}
            disabled={!isReadyToSave(draft)}
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-4" /> Add indentor
          </button>
          {indentorDraftDirty && !editingId ? (
            <button
              type="button"
              onClick={() => cancelIndentorDraftsRef.current()}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          ) : null}
        </div>
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
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[15%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[23%]" />
            <col className="w-[10%]" />
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
                const usageCount =
                  indentorUsage.get(getIndentorUsageKey(indentor.name, indentor.divisionId))?.fileIds
                    .size ?? 0;
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
                    <td className="break-words px-3 py-3">
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
                    <td className="px-3 py-3">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEdit(indentor.id)}
                                disabled={!editChanged || !isReadyToSave(editDraft)}
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
                              {usageCount > 0 ? (
                                <button
                                  type="button"
                                  disabled
                                  title={`Used in ${usageCount} file${usageCount === 1 ? "" : "s"}, including Archive. Historical references are protected.`}
                                  aria-label={`Cannot delete ${indentor.name}; it is used in file history`}
                                  className="size-8 grid place-items-center rounded-md text-muted-foreground opacity-60"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              ) : (
                                <HelpedControl
                                  helper={settingsControlHelpers.archiveEntity}
                                  label={`Archive ${indentor.name} help`}
                                >
                                  <DeleteConfirmation mode="archive" onConfirm={() => deleteIndentor(indentor.id)}>
                                    <button
                                      type="button"
                                      className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="size-4" />
                                    </button>
                                  </DeleteConfirmation>
                                </HelpedControl>
                              )}
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
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />
    </div>
  );
}

function IpAccessSettings() {
  const draft = useContext(SettingsDraftContext);
  const [config, setConfig] = useState<IpAccessConfig | undefined>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [remarks, setRemarks] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [draftMode, setDraftMode] = useState<IpAccessMode | undefined>();
  const [pendingAdds, setPendingAdds] = useState<TrustedIpAddress[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<string, { remarks?: string; active?: boolean }>
  >({});
  const saveIpChangesRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelIpChangesRef = useRef<() => void>(() => undefined);

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

  const hasIpChanges =
    Boolean(config && draftMode && draftMode !== config.mode) ||
    pendingAdds.length > 0 ||
    Object.keys(pendingUpdates).length > 0;

  const cancelIpChanges = useCallback(() => {
    setDraftMode(undefined);
    setPendingAdds([]);
    setPendingUpdates({});
    setMessage("");
  }, []);

  const saveIpChanges = useCallback(async () => {
    if (!config || !hasIpChanges) return;
    setLoading(true);
    try {
      // Fetch the current server state before applying the draft. This keeps the
      // verification below meaningful even when the settings page has been open
      // while another Admin changed the allowlist.
      const initialConfig = await store.getIpAccessConfig();
      let nextConfig = initialConfig;

      // Apply trusted-address changes first. In particular, never enable Restrict
      // until the allowlist has been written and verified successfully.
      for (const row of pendingAdds) {
        nextConfig = await store.addTrustedIpAddress(row.ipAddress, row.remarks);
      }
      for (const [id, patch] of Object.entries(pendingUpdates)) {
        nextConfig = await store.updateTrustedIpAddress(id, patch);
      }

      const normalizeTrustedIp = (value: string) =>
        value.trim().replace(/^::ffff:/i, "").replace(/^::1$/, "127.0.0.1");
      const expectedTrustedIps: TrustedIpAddress[] = initialConfig.trustedIps.map((row) => ({
        ...row,
      }));
      for (const row of pendingAdds) {
        const normalizedIp = normalizeTrustedIp(row.ipAddress);
        const existingIndex = expectedTrustedIps.findIndex(
          (existing) => normalizeTrustedIp(existing.ipAddress) === normalizedIp,
        );
        if (existingIndex === -1) {
          expectedTrustedIps.push({ ...row, ipAddress: normalizedIp, active: true });
        } else {
          expectedTrustedIps[existingIndex] = {
            ...expectedTrustedIps[existingIndex],
            ipAddress: normalizedIp,
            remarks: row.remarks,
            active: true,
          };
        }
      }
      for (const [id, patch] of Object.entries(pendingUpdates)) {
        const existingIndex = expectedTrustedIps.findIndex((row) => row.id === id);
        if (existingIndex !== -1) {
          expectedTrustedIps[existingIndex] = { ...expectedTrustedIps[existingIndex], ...patch };
        }
      }
      const trustedIpState = (rows: TrustedIpAddress[]) => {
        const normalizedRows = rows.map((row) => {
          const ipAddress = normalizeTrustedIp(row.ipAddress);
          return [
            ipAddress,
            { ipAddress, remarks: row.remarks.trim(), active: Boolean(row.active) },
          ] as const;
        });
        return Array.from(new Map(normalizedRows).values()).sort((left, right) =>
          left.ipAddress.localeCompare(right.ipAddress),
        );
      };
      if (
        JSON.stringify(trustedIpState(nextConfig.trustedIps)) !==
        JSON.stringify(trustedIpState(expectedTrustedIps))
      ) {
        throw new Error("Trusted IP changes could not be verified; Restrict mode was not enabled.");
      }

      const resultingMode = draftMode ?? nextConfig.mode;
      if (resultingMode === "restrict" && !nextConfig.trustedIps.some((row) => row.active)) {
        throw new Error("Add at least one active trusted IP before enabling Restrict mode.");
      }

      if (draftMode && draftMode !== nextConfig.mode) {
        nextConfig = await store.updateIpAccessMode(draftMode);
      }

      setConfig(nextConfig);
      setDraftMode(undefined);
      setPendingAdds([]);
      setPendingUpdates({});
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save IP access settings.");
      throw error;
    } finally {
      setLoading(false);
    }
  }, [config, draftMode, hasIpChanges, pendingAdds, pendingUpdates]);

  saveIpChangesRef.current = saveIpChanges;
  cancelIpChangesRef.current = cancelIpChanges;

  useEffect(() => {
    draft?.registerExternalDraft?.({
      save: () => saveIpChangesRef.current(),
      cancel: () => cancelIpChangesRef.current(),
    });
    return () => draft?.registerExternalDraft?.(null);
  }, [draft?.registerExternalDraft]);

  useEffect(() => {
    draft?.setExternalDirty?.(hasIpChanges);
  }, [draft?.setExternalDirty, hasIpChanges]);

  const updateMode = async (mode: IpAccessMode) => {
    if (
      mode === "restrict" &&
      !(await showAppConfirm(
        "Restrict mode blocks login from IPs that are not active in the trusted list. Continue?",
        { destructive: true },
      ))
    ) {
      return;
    }
    setDraftMode(mode);
  };

  const addIp = (value = ipAddress) => {
    if (!value.trim()) return;
    const now = new Date().toISOString();
    setPendingAdds((current) => [
      ...current,
      {
        id: `pending-${Date.now()}-${current.length}`,
        ipAddress: value.trim(),
        remarks: remarks.trim(),
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    setIpAddress("");
    setRemarks("");
  };

  const updateTrustedIp = async (id: string, patch: { remarks?: string; active?: boolean }) => {
    if (id.startsWith("pending-")) {
      setPendingAdds((current) =>
        current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
      return;
    }
    setPendingUpdates((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };

  const displayedTrustedIps = (config?.trustedIps ?? []).map((row) => ({
    ...row,
    ...(pendingUpdates[row.id] ?? {}),
  }));
  displayedTrustedIps.push(...pendingAdds);

  const permanentlyDeleteArchivedAttempt = async (attempt: IpLoginAttempt) => {
    const deletionPassword = await promptDeletionPassword(
      `permanently delete archived IP attempt "${attempt.ipAddress}"`,
    );
    if (deletionPassword === null) return;
    try {
      setConfig(await store.permanentlyDeleteArchivedIpLoginAttempt(attempt.id, deletionPassword));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete archived IP attempt.");
      throw error;
    }
  };

  const activeAttempts = config?.attempts ?? [];
  const archivedAttempts = config?.archivedAttempts ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
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

        <div className="grid items-end gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="block">
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Mode
              <SettingsHelper items={settingsControlHelpers.ipMode} label="IP access mode help" />
            </div>
            <select
              value={draftMode ?? config?.mode ?? "off"}
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
            <div className="min-w-0">
              <div className="flex min-h-10 items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2">
                <div className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  Current detected IP
                  <SettingsHelper
                    items={settingsControlHelpers.ipCurrent}
                    label="Current detected IP help"
                  />
                </div>
                <div className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold">
                  {config?.currentIp || "Not detected"}
                </div>
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
            <SettingsHelper
              items={settingsControlHelpers.ipManualAddress}
              label="IP address help"
            />
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

      <TrustedIpTable rows={displayedTrustedIps} onUpdate={updateTrustedIp} />

      <IpAttemptTable
        title={`New IP login history (${activeAttempts.length})`}
        rows={activeAttempts}
        archived={false}
        onArchive={async (id) => setConfig(await store.archiveIpLoginAttempt(id))}
      />

      <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            New IP bin / archive ({archivedAttempts.length})
            <SettingsHelper
              items={settingsControlHelpers.ipAttemptBin}
              label="New IP archive help"
            />
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
    <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
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
                    <ClearableInput
                      value={row.remarks}
                      onChange={(event) => void onUpdate(row.id, { remarks: event.target.value })}
                      onClear={() => void onUpdate(row.id, { remarks: "" })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) =>
                          void onUpdate(row.id, { active: event.target.checked })
                        }
                      />
                      {row.active ? "Active" : "Inactive"}
                    </label>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.createdByName || "-"}</td>
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
    <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
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
                        <DeleteConfirmation
                          mode="archive"
                          actionLabel="Archive attempt"
                          description="This login attempt will be moved to the archived list. You can permanently delete it from there later."
                          onConfirm={() => onArchive(row.id)}
                        >
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                          >
                            Archive
                          </button>
                        </DeleteConfirmation>
                      </HelpedControl>
                    ) : archived && onDelete ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {row.archivedByName ? `By ${row.archivedByName}` : "Archived"}
                        </span>
                        <DeleteConfirmation onConfirm={() => onDelete(row)}>
                          <button
                            type="button"
                            className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                          >
                            Delete
                          </button>
                        </DeleteConfirmation>
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

function roleRequiresDivisionAssignment(role: AppUserRole) {
  return role !== "admin";
}

function UserSettings() {
  const draftContext = useContext(SettingsDraftContext);
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
  const [userMutation, setUserMutation] = useState<"" | "add" | "edit">("");
  const [userMessage, setUserMessage] = useState("");
  type UserRoleTab = "admin" | "sub_admin" | "editor" | "universal_viewer" | "division_users";
  const [userRoleTab, setUserRoleTab] = useState<UserRoleTab>("admin");
  const roleTabs: readonly {
    value: UserRoleTab;
    label: string;
    matches: (user: (typeof users)[number]) => boolean;
  }[] = [
    { value: "admin", label: "Admin", matches: (user) => user.role === "admin" },
    { value: "sub_admin", label: "Sub-admin", matches: (user) => user.role === "sub_admin" },
    { value: "editor", label: "Editor", matches: (user) => user.role === "editor" },
    {
      value: "universal_viewer",
      label: "Universal viewer",
      matches: (user) => user.role === "universal_viewer",
    },
    {
      value: "division_users",
      label: "Division users",
      // `viewer` is retained as a legacy division-scoped role, so it stays visible here.
      matches: (user) => user.role === "division_user" || user.role === "viewer",
    },
  ];
  const selectedRoleTab = roleTabs.find((tab) => tab.value === userRoleTab) ?? roleTabs[0];
  const visibleUsers = useMemo(
    () => users.filter((user) => selectedRoleTab.matches(user)),
    [selectedRoleTab, users],
  );

  const add = async () => {
    if (
      userMutation ||
      !name.trim() ||
      !username.trim() ||
      !password.trim() ||
      (roleRequiresDivisionAssignment(role) && divisionIds.length === 0)
    )
      return;
    setUserMutation("add");
    setUserMessage("");
    try {
      await store.addUser({
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
    } catch (error) {
      setUserMessage(getErrorMessage(error));
    } finally {
      setUserMutation("");
    }
  };

  const startEdit = (user: (typeof users)[number]) => {
    setUserMessage("");
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

  const saveEdit = async (id: string) => {
    if (
      userMutation ||
      !editName.trim() ||
      !editUsername.trim() ||
      (roleRequiresDivisionAssignment(editRole) && editDivisionIds.length === 0)
    )
      return;
    setUserMutation("edit");
    setUserMessage("");
    try {
      await store.updateUser(id, {
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
    } catch (error) {
      setUserMessage(getErrorMessage(error));
    } finally {
      setUserMutation("");
    }
  };

  const userDraftDirty = Boolean(
    name.trim() ||
    username.trim() ||
    password.trim() ||
    role !== "editor" ||
    cashOutgoEditScope !== "none" ||
    emergencyIpBypass ||
    divisionIds.length ||
    !isSettingsDirtyValueEqual(allowedFileCategories, allFileAccessKeys) ||
    editingId,
  );
  const cancelUserDraftsRef = useRef(() => undefined);
  cancelUserDraftsRef.current = () => {
    setName("");
    setUsername("");
    setPassword("");
    setRole("editor");
    setCashOutgoEditScope("none");
    setEmergencyIpBypass(false);
    setDivisionIds([]);
    setAllowedFileCategories(allFileAccessKeys);
    setEditingId(null);
    setEditName("");
    setEditUsername("");
    setEditPassword("");
    setEditRole("editor");
    setEditCashOutgoEditScope("none");
    setEditEmergencyIpBypass(false);
    setEditDivisionIds([]);
    setEditAllowedFileCategories([]);
    setUserMessage("");
  };

  useEffect(() => {
    if (!draftContext?.registerExternalDraft) return;
    draftContext.registerExternalDraft({
      save: async () => undefined,
      cancel: () => cancelUserDraftsRef.current(),
    });
    return () => draftContext.registerExternalDraft?.(null);
  }, [draftContext?.registerExternalDraft]);

  useEffect(() => {
    draftContext?.setLocalDirty?.(userDraftDirty);
  }, [draftContext?.setLocalDirty, userDraftDirty]);

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold">
        Authorised users
        <AuthorisedUserRolesTooltip />
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add users and assign the divisions they should be allowed to work with.
      </p>
      {userMessage ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {userMessage}
        </div>
      ) : null}
      <div className="mb-4 rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Role distinction:</span> Viewer is a
        division-password login for exactly one division. Division user is a named account with its
        own login and one or more assigned divisions. Both are read-only for file records, but both
        can submit file queries/messages; neither can resolve or reply to them.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="User name" />
        <DivisionInput value={username} onChange={setUsername} placeholder="Username" />
        <PasswordInput
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <UserRoleSelect value={role} onChange={setRole} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void add()}
            disabled={
              Boolean(userMutation) ||
              !name.trim() ||
              !username.trim() ||
              !password.trim() ||
              (roleRequiresDivisionAssignment(role) && divisionIds.length === 0)
            }
            className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-4" /> Add
          </button>
          {userDraftDirty && !editingId ? (
            <button
              type="button"
              onClick={() => cancelUserDraftsRef.current()}
              disabled={Boolean(userMutation)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          ) : null}
        </div>
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
        {roleRequiresDivisionAssignment(role) && divisionIds.length === 0 ? (
          <div className="mt-1.5 text-xs font-medium text-destructive">
            No divisions assigned — assign at least one division before adding this restricted user.
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Allowed file types</div>
        <FileCategoryAccessPicker
          options={fileAccessOptions}
          selectedCategories={allowedFileCategories}
          onChange={setAllowedFileCategories}
        />
      </div>

      <Tabs
        value={userRoleTab}
        onValueChange={(value) => setUserRoleTab(value as UserRoleTab)}
        className="mt-5"
      >
        <TabsList
          aria-label="Authorised users by role"
          className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-md border border-border bg-background p-1"
        >
          {roleTabs.map((tab) => {
            const count = users.filter((user) => tab.matches(user)).length;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 px-3 py-2">
                <span>{tab.label}</span>
                <span className="text-xs text-muted-foreground">({count})</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={userRoleTab} className="mt-3">
          <div className="overflow-x-auto rounded-md border border-border">
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
                {visibleUsers.length === 0 ? (
                  <tr className="border-t border-border">
                    <td className="px-4 py-6 text-muted-foreground text-center" colSpan={7}>
                      No {selectedRoleTab.label.toLowerCase()} users added yet.
                    </td>
                  </tr>
                ) : (
                  visibleUsers.map((user) => {
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
                              <PasswordInput
                                value={editPassword}
                                onChange={(event) => setEditPassword(event.target.value)}
                                placeholder="New password"
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
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
                                <div className="mt-1 text-xs text-destructive">
                                  Emergency IP bypass
                                </div>
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
                            <div>
                              <DivisionAccessPicker
                                divisions={divisions}
                                selectedIds={editDivisionIds}
                                onChange={setEditDivisionIds}
                              />
                              {roleRequiresDivisionAssignment(editRole) &&
                              editDivisionIds.length === 0 ? (
                                <div className="mt-1.5 text-xs font-medium text-destructive">
                                  No divisions assigned — assign at least one division before
                                  saving.
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span
                              className={
                                roleRequiresDivisionAssignment(user.role) &&
                                user.divisionIds.length === 0
                                  ? "font-medium text-destructive"
                                  : undefined
                              }
                            >
                              {roleRequiresDivisionAssignment(user.role) &&
                              user.divisionIds.length === 0
                                ? "No divisions assigned"
                                : divisionAccessLabel(user.divisionIds, divisions, user.role)}
                            </span>
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
                                  onClick={() => void saveEdit(user.id)}
                                  disabled={
                                    Boolean(userMutation) ||
                                    !editChanged ||
                                    !editName.trim() ||
                                    !editUsername.trim() ||
                                    (roleRequiresDivisionAssignment(editRole) &&
                                      editDivisionIds.length === 0)
                                  }
                                  className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Check className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  disabled={Boolean(userMutation)}
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
                                  label={`Archive ${user.name} help`}
                                >
                                  <DeleteConfirmation
                                    mode="archive"
                                    onConfirm={async () => {
                                      if (
                                        await requestDeletionPassword(`archive user "${user.name}"`)
                                      ) {
                                        await store.deleteUser(user.id);
                                      }
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="size-4" />
                                    </button>
                                  </DeleteConfirmation>
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
        </TabsContent>
      </Tabs>
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
  const activeUser = useActiveUser();
  const isSubAdmin = activeUser?.role === "sub_admin";
  const [archivedFiles, setArchivedFiles] = useState<FileRecord[]>([]);
  const [cancelledDemandFiles, setCancelledDemandFiles] = useState<FileRecord[]>([]);
  const [archivedDivisions, setArchivedDivisions] = useState<Division[]>([]);
  const [archivedUsers, setArchivedUsers] = useState<AppUser[]>([]);
  const [archivedFirms, setArchivedFirms] = useState<MasterFirm[]>([]);
  const [archivedIndentors, setArchivedIndentors] = useState<Indentor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadArchive = async () => {
    setLoading(true);
    setError(undefined);
    // Do not leave a previous response actionable while this refresh is in
    // flight. A failed request must leave the bin empty, not showing stale rows.
    setArchivedFiles([]);
    setCancelledDemandFiles([]);
    setArchivedDivisions([]);
    setArchivedUsers([]);
    setArchivedFirms([]);
    setArchivedIndentors([]);
    try {
      if (isSubAdmin) {
        const [archivedResult, cancelledResult] = await Promise.all([
          store.listArchivedFiles(),
          store.listCancelledDemandFiles(),
        ]);
        setArchivedFiles(archivedResult.files);
        setCancelledDemandFiles(cancelledResult.files);
        setArchivedDivisions([]);
        setArchivedUsers([]);
        setArchivedFirms([]);
        setArchivedIndentors([]);
        return;
      }
      const results = await Promise.allSettled([
        store.listArchivedFiles(),
        store.listCancelledDemandFiles(),
        store.listArchivedDivisions(),
        store.listArchivedUsers(),
        listArchivedMasterFirms(),
        store.listArchivedIndentors(),
      ]);
      const labels = [
        "Files",
        "Cancelled demands",
        "Divisions",
        "Users",
        "Master firms",
        "Indentors",
      ];
      const failures: string[] = [];

      if (results[0].status === "fulfilled") setArchivedFiles(results[0].value.files);
      else failures.push(`${labels[0]}: ${getErrorMessage(results[0].reason)}`);

      if (results[1].status === "fulfilled") setCancelledDemandFiles(results[1].value.files);
      else failures.push(`${labels[1]}: ${getErrorMessage(results[1].reason)}`);

      if (results[2].status === "fulfilled") setArchivedDivisions(results[2].value.divisions);
      else failures.push(`${labels[2]}: ${getErrorMessage(results[2].reason)}`);

      if (results[3].status === "fulfilled") setArchivedUsers(results[3].value.users);
      else failures.push(`${labels[3]}: ${getErrorMessage(results[3].reason)}`);

      if (results[4].status === "fulfilled") setArchivedFirms(results[4].value.firms);
      else failures.push(`${labels[4]}: ${getErrorMessage(results[4].reason)}`);

      if (results[5].status === "fulfilled") setArchivedIndentors(results[5].value.indentors);
      else failures.push(`${labels[5]}: ${getErrorMessage(results[5].reason)}`);

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
  }, [isSubAdmin]);

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
    await store.permanentlyDeleteArchivedDivision(division.id, deletionPassword);
    await loadArchive();
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Archive</h2>
          <p className="text-xs text-muted-foreground">
            {isSubAdmin
              ? "Review archived files and cancelled demands in your assigned divisions. Restore and other archive bins remain Admin-only."
              : "Review archived files, cancelled demands, divisions, users, firms, and indentors."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadArchive()}
          disabled={loading}
          className="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="files" className="mt-5">
        <TabsList
          aria-label="Archived records by type"
          className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-md border border-border bg-background p-1"
        >
          <TabsTrigger value="files" className="gap-1.5 px-3 py-2">
            Files <span className="text-xs text-muted-foreground">({archivedFiles.length})</span>
          </TabsTrigger>
          <TabsTrigger value="cancelledDemands" className="gap-1.5 px-3 py-2">
            Cancelled demands{" "}
            <span className="text-xs text-muted-foreground">({cancelledDemandFiles.length})</span>
          </TabsTrigger>
          {!isSubAdmin ? (
            <>
              <TabsTrigger value="divisions" className="gap-1.5 px-3 py-2">
                Divisions{" "}
                <span className="text-xs text-muted-foreground">({archivedDivisions.length})</span>
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-1.5 px-3 py-2">
                Users{" "}
                <span className="text-xs text-muted-foreground">({archivedUsers.length})</span>
              </TabsTrigger>
              <TabsTrigger value="firms" className="gap-1.5 px-3 py-2">
                Master firms{" "}
                <span className="text-xs text-muted-foreground">({archivedFirms.length})</span>
              </TabsTrigger>
              <TabsTrigger value="indentors" className="gap-1.5 px-3 py-2">
                Indentors{" "}
                <span className="text-xs text-muted-foreground">({archivedIndentors.length})</span>
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>

        <TabsContent value="divisions" className="mt-3">
          <details open className="overflow-hidden rounded-md border border-border">
            <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
              Divisions bin ({archivedDivisions.length})
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[20%]" />
                  <col className="w-[24%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Archived division</th>
                    <th className="px-4 py-2.5 text-left font-medium">Code</th>
                    <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
                    <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="border-t border-border">
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                        Loading archived divisions...
                      </td>
                    </tr>
                  ) : archivedDivisions.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
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
                              <DeleteConfirmation
                                onConfirm={() => permanentlyDeleteDivision(division)}
                              >
                                <button
                                  type="button"
                                  className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </DeleteConfirmation>
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
        </TabsContent>

        <TabsContent value="files" className="mt-3">
          <details open className="overflow-hidden rounded-md border border-border">
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
                        <td className="px-4 py-3 text-muted-foreground">
                          {file.year || "Not set"}
                        </td>
                        <td className="py-3 pl-8 pr-4">
                          <div className="flex justify-end gap-1">
                            {!isSubAdmin ? (
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
                            ) : null}
                            <HelpedControl
                              helper={settingsControlHelpers.archiveDelete}
                              label="Delete archived file help"
                            >
                              <DeleteConfirmation onConfirm={() => permanentlyDelete(file)}>
                                <button
                                  type="button"
                                  className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </DeleteConfirmation>
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
        </TabsContent>

        <TabsContent value="cancelledDemands" className="mt-3">
          <details open className="overflow-hidden rounded-md border border-border">
            <summary className="cursor-pointer bg-secondary px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">
              Cancelled demands ({cancelledDemandFiles.length})
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[18%]" />
                  <col className="w-[32%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Unique code</th>
                    <th className="px-4 py-2.5 text-left font-medium">Division</th>
                    <th className="px-4 py-2.5 text-left font-medium">Cancelled on</th>
                    <th className="px-4 py-2.5 text-left font-medium">Description</th>
                    <th className="px-4 py-2.5 text-left font-medium">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        Loading cancelled demands...
                      </td>
                    </tr>
                  ) : cancelledDemandFiles.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        No cancelled demands.
                      </td>
                    </tr>
                  ) : (
                    cancelledDemandFiles.map((file) => (
                      <tr key={file.id} className="border-t border-border align-top">
                        <td className="px-4 py-3 font-medium">{file.uniqueCode || "Not set"}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {file.division || "Not set"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {file.demandCancelledDate
                            ? formatArchiveDate(file.demandCancelledDate)
                            : "Not set"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {getArchivedFileDescription(file)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {file.year || "Not set"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </TabsContent>

        <TabsContent value="users" className="mt-3">
          <details className="overflow-hidden rounded-md border border-border">
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
                              <DeleteConfirmation onConfirm={() => permanentlyDeleteUser(user)}>
                                <button
                                  type="button"
                                  className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </DeleteConfirmation>
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
        </TabsContent>

        <TabsContent value="firms" className="mt-3">
          <details className="overflow-hidden rounded-md border border-border">
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
                        <td className="px-4 py-3 font-medium">
                          <CompactTableText value={firm.firmName || "Not set"} width={20} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {firm.firmUniqueNo || "Not set"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {firm.emailId || "Not set"}
                        </td>
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
                              <DeleteConfirmation onConfirm={() => permanentlyDeleteFirm(firm)}>
                                <button
                                  type="button"
                                  className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </DeleteConfirmation>
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
        </TabsContent>

        <TabsContent value="indentors" className="mt-3">
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
                              <DeleteConfirmation
                                onConfirm={() => permanentlyDeleteIndentor(indentor)}
                              >
                                <button
                                  type="button"
                                  className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </DeleteConfirmation>
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
        </TabsContent>
      </Tabs>
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
  options: readonly FileCategoryOption[] = fileCategoryOptions,
): FileCategoryKey[] {
  const optionKeys = options.map((option) => option.key);
  if (!values) return optionKeys;
  const allowedKeys = new Set(optionKeys);
  return options
    .map((option) => option.key)
    .filter((key) => values.includes(key) && allowedKeys.has(key));
}

function fileCategoryAccessLabel(
  values: string[] | null | undefined,
  options: readonly FileCategoryOption[] = fileCategoryOptions,
) {
  const categories = normalizeUserFileCategories(values, options);
  if (categories.length === options.length) return "All file types";
  if (categories.length === 0) return "No file types";
  return categories
    .map((key) => options.find((option) => option.key === key)?.label)
    .filter(Boolean)
    .join(", ");
}

function divisionAccessLabel(
  selectedIds: string[],
  divisions: ReturnType<typeof useDivisions>,
  role?: AppUserRole,
) {
  if (role === "admin") return "All divisions (not restricted)";
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
      <div className="text-xs font-semibold mb-1.5">{label}</div>
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
      <PasswordInput
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
    <ClearableInput
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onClear={() => onChange("")}
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
    <SearchableDropdown
      value={value}
      onChange={onChange}
      options={[]}
      optionItems={divisions.map((division) => ({
        value: division.id,
        label: division.name,
      }))}
      placeholder="Select division"
      deferChangeUntilSelect
      allowCustomValue={false}
      disabled={disabled}
      className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70"
    />
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
    <td className="break-words px-3 py-3 text-muted-foreground">
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
      <div className="text-xs font-semibold mb-1.5">{label}</div>
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
      <div className="text-xs font-semibold mb-1.5">{label}</div>
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

const appearancePresetOptions: Array<{
  value: AppearancePreset;
  label: string;
  description: string;
  theme: "light" | "dark";
  themeTint: "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
  topRibbonColor: TopRibbonColor;
  topRibbonTextColor: TopRibbonTextColor;
  fontFamily: AppFontFamily;
  colors: [string, string];
}> = [
  {
    value: "ocean",
    label: "Ocean clarity",
    description: "Cool blue surfaces with a calm teal ribbon.",
    theme: "light",
    themeTint: "blue",
    topRibbonColor: "teal",
    topRibbonTextColor: "white",
    fontFamily: "inter",
    colors: ["#eaf3f7", "#0f4c5c"],
  },
  {
    value: "forest",
    label: "Forest calm",
    description: "Soft green surfaces with a deep navy ribbon.",
    theme: "light",
    themeTint: "green",
    topRibbonColor: "navy",
    topRibbonTextColor: "softWhite",
    fontFamily: "sourceSans",
    colors: ["#edf6f1", "#082733"],
  },
  {
    value: "graphite",
    label: "Graphite focus",
    description: "Dark charcoal surfaces with warm, readable lettering.",
    theme: "dark",
    themeTint: "plain",
    topRibbonColor: "charcoal",
    topRibbonTextColor: "softWhite",
    fontFamily: "manrope",
    colors: ["#20252b", "#f1f4f6"],
  },
  {
    value: "plum",
    label: "Plum studio",
    description: "A gentle lavender workspace with an indigo ribbon.",
    theme: "light",
    themeTint: "lavender",
    topRibbonColor: "indigo",
    topRibbonTextColor: "white",
    fontFamily: "nunito",
    colors: ["#f2effa", "#24234a"],
  },
  {
    value: "arcticGlass",
    label: "Arctic glass",
    description: "Crisp blue-white surfaces with a calm teal ribbon.",
    theme: "light",
    themeTint: "blue",
    topRibbonColor: "teal",
    topRibbonTextColor: "softWhite",
    fontFamily: "inter",
    colors: ["#f2f8fb", "#0f4c5c"],
  },
  {
    value: "sageModern",
    label: "Sage modern",
    description: "Fresh sage surfaces with a dependable navy ribbon.",
    theme: "light",
    themeTint: "green",
    topRibbonColor: "navy",
    topRibbonTextColor: "softWhite",
    fontFamily: "sourceSans",
    colors: ["#eff7f1", "#082733"],
  },
  {
    value: "sunsetEditorial",
    label: "Sunset editorial",
    description: "Warm cream surfaces with a confident maroon ribbon.",
    theme: "light",
    themeTint: "yellow",
    topRibbonColor: "maroon",
    topRibbonTextColor: "gold",
    fontFamily: "sourceSans",
    colors: ["#fff8e8", "#4f1d24"],
  },
  {
    value: "roseQuartz",
    label: "Rose quartz",
    description: "A soft rose workspace with a refined maroon ribbon.",
    theme: "light",
    themeTint: "pink",
    topRibbonColor: "maroon",
    topRibbonTextColor: "softWhite",
    fontFamily: "nunito",
    colors: ["#fff1f4", "#4f1d24"],
  },
  {
    value: "midnightIndigo",
    label: "Midnight indigo",
    description: "A focused dark workspace with a rich indigo ribbon.",
    theme: "dark",
    themeTint: "plain",
    topRibbonColor: "indigo",
    topRibbonTextColor: "softWhite",
    fontFamily: "manrope",
    colors: ["#111329", "#24234a"],
  },
];

const fontFamilyOptions: Array<{ value: AppFontFamily; label: string; sample: string }> = [
  { value: "inter", label: "Inter", sample: "Clean and compact" },
  { value: "manrope", label: "Manrope", sample: "Modern and rounded" },
  { value: "sourceSans", label: "Source Sans 3", sample: "Open and readable" },
  { value: "nunito", label: "Nunito Sans", sample: "Friendly and soft" },
];

const topRibbonColorOptions: Array<{ value: TopRibbonColor; label: string; color: string }> = [
  { value: "navy", label: "GeM navy", color: "#082733" },
  { value: "teal", label: "Deep teal", color: "#0f4c5c" },
  { value: "charcoal", label: "Charcoal", color: "#20252b" },
  { value: "maroon", label: "Maroon", color: "#4f1d24" },
  { value: "indigo", label: "Indigo", color: "#24234a" },
  { value: "gold", label: "Gold", color: "#8a5a00" },
  { value: "warmGold", label: "Warm gold", color: "#f7d774" },
  { value: "black", label: "Black", color: "#111111" },
];

const topRibbonTextColorOptions: Array<{
  value: TopRibbonTextColor;
  label: string;
  color: string;
}> = [
  { value: "white", label: "White", color: "#ffffff" },
  { value: "softWhite", label: "Soft white", color: "#e6eef2" },
  { value: "gold", label: "Warm gold", color: "#f7d774" },
  { value: "black", label: "Black", color: "#111827" },
  { value: "brickRed", label: "Brick red", color: "#b7473f" },
];

function AppearancePresetField({
  value,
  onChange,
}: {
  value?: AppearancePreset | null;
  onChange: (value: AppearancePreset | null) => void;
}) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1.5 text-xs font-semibold">Modern appearance preset</legend>
      <p className="mb-2 text-xs text-muted-foreground">
        Presets apply a coordinated screen theme, ribbon, lettering and font. Leave this on Standard
        to keep the regular theme.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={!value}
          className={`rounded-md border px-3 py-2 text-left text-xs transition-shadow ${
            !value ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-accent"
          }`}
        >
          <span className="block font-semibold">Standard theme</span>
          <span className="mt-0.5 block text-muted-foreground">Use regular screen colours</span>
        </button>
        {appearancePresetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded-md border px-3 py-2 text-left text-xs transition-shadow ${
              value === option.value
                ? "border-primary ring-2 ring-primary/25"
                : "border-border hover:bg-accent"
            }`}
          >
            <span className="mb-1 flex items-center gap-1.5 font-semibold">
              <span
                className="size-3.5 rounded-full border border-black/15"
                style={{
                  background: `linear-gradient(135deg, ${option.colors[0]} 50%, ${option.colors[1]} 50%)`,
                }}
                aria-hidden="true"
              />
              {option.label}
            </span>
            <span className="block text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TopRibbonColorField({
  value,
  onChange,
}: {
  value?: TopRibbonColor | null;
  onChange: (value: TopRibbonColor | null) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold">Top ribbon colour</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={!value}
          className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium transition-shadow ${
            !value ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-accent"
          }`}
        >
          <span
            className="size-4 rounded-full border border-border bg-background"
            aria-hidden="true"
          />
          Regular theme
        </button>
        {topRibbonColorOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium transition-shadow ${
              value === option.value
                ? "border-primary ring-2 ring-primary/25"
                : "border-border hover:bg-accent"
            }`}
          >
            <span
              className="size-4 rounded-full border border-black/20 shadow-inner"
              style={{ backgroundColor: option.color }}
              aria-hidden="true"
            />
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TopRibbonTextColorField({
  value,
  onChange,
}: {
  value?: TopRibbonTextColor | null;
  onChange: (value: TopRibbonTextColor | null) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold">Top ribbon letters</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={!value}
          className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium transition-shadow ${
            !value ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-accent"
          }`}
        >
          <span
            className="size-4 rounded-full border border-border bg-background"
            aria-hidden="true"
          />
          Regular theme
        </button>
        {topRibbonTextColorOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium transition-shadow ${
              value === option.value
                ? "border-primary ring-2 ring-primary/25"
                : "border-border hover:bg-accent"
            }`}
          >
            <span
              className="size-4 rounded-full border border-black/20 shadow-inner"
              style={{ backgroundColor: option.color }}
              aria-hidden="true"
            />
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FontFamilyField({
  value,
  onChange,
}: {
  value?: AppFontFamily | null;
  onChange: (value: AppFontFamily | null) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold">Font</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={!value}
          className={`rounded-md border px-2.5 py-2 text-left text-xs transition-shadow ${
            !value ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-accent"
          }`}
        >
          <span className="block font-medium">Regular</span>
          <span className="block text-muted-foreground">Default font</span>
        </button>
        {fontFamilyOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded-md border px-2.5 py-2 text-left text-xs transition-shadow ${
              value === option.value
                ? "border-primary ring-2 ring-primary/25"
                : "border-border hover:bg-accent"
            }`}
          >
            <span className="block font-medium">{option.label}</span>
            <span className="block text-muted-foreground">{option.sample}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ChartColorOrderField({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const orderedColors = [
    ...new Set(value.filter((color) => chartColorOptions.some((option) => option.color === color))),
    ...chartColorOptions.map((option) => option.color).filter((color) => !value.includes(color)),
  ];

  const moveColor = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= orderedColors.length) return;
    const next = [...orderedColors];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };

  return (
    <fieldset className="block">
      <legend className="mb-1.5 text-xs font-semibold">
        Chart colour priority for bars, columns and pie charts
      </legend>
      <p className="mb-2 text-xs text-muted-foreground">
        {disabled
          ? "An administrator is setting the colour order for all users."
          : "Saved to your account. Bars, columns and pie slices use colours from top to bottom, as needed."}
      </p>
      <ol className="space-y-1">
        {orderedColors.map((color, index) => {
          const option = chartColorOptions.find((item) => item.color === color)!;
          return (
            <li
              key={color}
              className="flex items-center gap-2 rounded border border-border px-2 py-1"
            >
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span
                className="size-4 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 text-xs">{option.label}</span>
              <button
                type="button"
                onClick={() => moveColor(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Move ${option.label} earlier`}
                title="Move earlier"
                className="grid size-7 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveColor(index, 1)}
                disabled={disabled || index === orderedColors.length - 1}
                aria-label={`Move ${option.label} later`}
                title="Move later"
                className="grid size-7 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}

function RibbonFieldSelect({
  label,
  value,
  excludeValue,
  onChange,
}: {
  label: string;
  value: AddEditRibbonFieldKey;
  excludeValue?: AddEditRibbonFieldKey;
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
        {addEditRibbonFieldOptions
          .filter((option) => option.key !== excludeValue)
          .map((option) => (
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
