import { createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Info,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { CompactTableText } from "@/components/compact-table-text";
import { QuickAccessSettings } from "@/components/quick-access";
import { QuickEntryExcelSettings } from "@/components/quick-entry-excel";
import { chartColorOptions } from "@/lib/chart-colors";
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
import { promptDeletionPassword, promptPassword, requestDeletionPassword } from "@/lib/delete-password";
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

type SettingsDraftContextValue = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
};

const SettingsDraftContext = createContext<SettingsDraftContextValue | null>(null);

function useSettings() {
  const draft = useContext(SettingsDraftContext);
  const savedSettings = useStoreSettings();
  return draft?.settings ?? savedSettings;
}

function useSettingsUpdater() {
  const draft = useContext(SettingsDraftContext);
  return draft?.updateSettings ?? store.updateSettings;
}

function UserSettingsDraft({
  children,
  scope = "personal",
  editors = "You",
  showScope = true,
}: {
  children: ReactNode;
  scope?: SettingsScopeKind;
  editors?: string;
  showScope?: boolean;
}) {
  const savedSettings = useStoreSettings();
  const [draftPatch, setDraftPatch] = useState<Partial<AppSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const hasChanges = Object.keys(draftPatch).length > 0;
  const updateSettings = (patch: Partial<AppSettings>) => {
    setDraftPatch((current) => ({ ...current, ...patch }));
    setSaveError("");
  };
  const cancelChanges = () => {
    if (hasChanges && !window.confirm("Discard your unsaved settings changes?")) return;
    setDraftPatch({});
    setSaveError("");
  };
  const saveChanges = async () => {
    if (!hasChanges || saving) return;
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
  return (
    <div className="space-y-3">
      {showScope ? <SettingsScope scope={scope} editors={editors} /> : null}
      <div className="flex items-center justify-end gap-2">
        {saveError ? <p role="alert" className="mr-auto text-sm text-destructive">{saveError}</p> : null}
        <button
          type="button"
          onClick={cancelChanges}
          disabled={saving || !hasChanges}
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
      <SettingsDraftContext.Provider
        value={{ settings: { ...savedSettings, ...draftPatch }, updateSettings }}
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

type SettingsScopeKind = "personal" | "shared";

function SettingsScope({
  scope,
  editors,
}: {
  scope: SettingsScopeKind;
  editors: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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
    return { scope: "shared" as const, editors: "Administrators and Sub-admins" };
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
  "noticeBoard",
  "quickEntryExcel",
]);

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
  noticeBoard: ["Administrator displays and rotation duration are saved centrally and appear for other accounts after refresh or sign-in. Personal displays stay on this browser."],
  quickEntryExcel: [
    "Administrators configure Excel exports here. Saved exports are shared with all users on the Quick Entry page.",
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
    "Example row: Bill sent: 10 Oct | 20 days | 30 Oct | Expected payment date is estimated from the submission date plus the configured offset; it is not an actual payment date.",
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
    "The 'Used in N files' figure counts unique files, including archived files, where this milestone is current or completed on the file, an S.O., or its advance-payment record.",
    "Details: Status-1 and Status-3 use their own standard workflow logic, so this sequence does not change their counters.",
    "Included and Excluded: Inactive milestones are excluded from the active sequence, but their saved dates and completion data are not erased immediately.",
    "Included and Excluded: An inactive milestone may no longer appear on a file's checklist.",
    "Add or activate: Add places a new milestone at the selected position.",
    "Add or activate: Activate restores an inactive milestone at the end of the active sequence, just before File Closed.",
    "Reorder: Use the arrows to change the displayed sequence.",
    "Reorder: File Closed remains last, and some standard milestones stay in positions controlled by the software.",
    "Reorder: This sequence breaks ties for events on the same day and orders undated milestones in Show all dates.",
    "Remove: A milestone used by a file can only be inactivated. An unused milestone can be deleted permanently.",
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
    "Archived IP attempts can be permanently deleted with the configured deletion password.",
  ],
  archive: [
    "Archived records appear here with restore and permanent-delete actions.",
    "Restore returns an archived setting to active use; permanent deletion removes it and needs the configured deletion password.",
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
} satisfies Record<string, string[]>;

const deletionPasswordHelper = [
  "Required for deleting files, financial years, and permanently deleting archived records.",
  "Keep it known only to admins who are allowed to perform delete actions.",
  "Changing it applies to future delete confirmations.",
];

const settingsControlHelpers = {
  genericAdd: [
    "Makes this choice available for new entries.",
    "Existing files keep the value already saved on them.",
  ],
  workspaceDelete: [
    "Deletes only the selected FY from workspace year options.",
    "Current FY and any FY having files cannot be deleted.",
    "Deletion password required.",
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
  userDelete: [
    "Moves this user account out of active use.",
    "Deletion password required.",
  ],
  universalViewerCashOutgoScope: [
    "View-only users cannot save MER or Cash Out Go Plan changes.",
    "Personal Cash Out Go saves offsets and dates for that Universal Viewer account only.",
    "Global Cash Out Go + MER saves the official plan and MER for everyone.",
  ],
  archiveRestore: [
    "Restores the archived item back to active records.",
    "Review details after restore if related settings have changed.",
  ],
  archiveDelete: [
    "Permanently deletes the archived item.",
    "Deletion password required. This action cannot be undone from this screen.",
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
    "Permanent deletion from this bin needs the configured deletion password.",
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
  return role === "admin" || role === "sub_admin" || role === "universal_viewer";
}

function useSettingsUsageFiles() {
  const fallbackFiles = useFiles();
  const [usageFiles, setUsageFiles] = useState<FileRecord[]>(
    () => fallbackFiles,
  );

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

function SettingsPage() {
  const activeUser = useActiveUser();
  const settingsRole: AppUserRole | undefined = activeUser?.role;
  const locationSearch = useRouterState({ select: (state) => state.location.search });
  const [activeAdminSection, setActiveAdminSection] = useState("theme");
  const [unlockedAdminSections, setUnlockedAdminSections] = useState<Record<string, boolean>>({});
  const [hasUnsavedAdminChanges, setHasUnsavedAdminChanges] = useState(false);
  const [settingsSidePanelHooked, setSettingsSidePanelHooked] = useState(true);
  const [expandedAdminGroup, setExpandedAdminGroup] = useState("personal");

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
            <SettingsTabTrigger value="noticeBoard" label="Notice board" helperKey="noticeBoard" />
            <SettingsTabTrigger value="indentors" label="Indentors" helperKey="indentors" />
            <SettingsTabTrigger value="presets" label="Preset table fields" helperKey="presets" />
          </TabsList>
          <TabsContent value="theme">
            <UserSettingsDraft showScope={false}><PreferenceSettings /></UserSettingsDraft>
          </TabsContent>
          <TabsContent value="noticeBoard"><QuickAccessSettings section="noticeBoard" /></TabsContent>
          <TabsContent value="indentors">
            <SettingsScope scope="shared" editors="Administrators and Sub-admins" />
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="presets">
            <UserSettingsDraft><TableFieldPresetSettings /></UserSettingsDraft>
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
            <SettingsTabTrigger value="theme" label="UI theme" helperKey="theme" />
            <SettingsTabTrigger value="noticeBoard" label="Notice board" helperKey="noticeBoard" />
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
          <TabsContent value="theme">
            <UserSettingsDraft showScope={false}><PreferenceSettings /></UserSettingsDraft>
          </TabsContent>
          <TabsContent value="noticeBoard"><QuickAccessSettings section="noticeBoard" /></TabsContent>
          <TabsContent value="user">
            <UserSettingsDraft><AccountSettings /></UserSettingsDraft>
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
            <UserSettingsDraft><TableFieldPresetSettings /></UserSettingsDraft>
          </TabsContent>
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
  ];
  const universalViewer = isUniversalViewer(activeUser?.role);
  const adminSections = universalViewer
    ? allAdminSections.filter((section) =>
        [
          "theme",
          "user",
          "presets",
          "offsetDays",
          "noticeBoard",
        ].includes(section.key),
      )
    : settingsRole === "sub_admin"
      ? allAdminSections.filter((section) => ["theme", "user", "workspace", "offsetDays"].includes(section.key))
      : allAdminSections;
  const selectedAdminSection =
    adminSections.find((section) => section.key === activeAdminSection) ?? adminSections[0];
  const selectedAdminSectionUnlocked =
    Boolean(unlockedAdminSections[selectedAdminSection.key]) ||
    selectedAdminSection.key === "theme" ||
    (universalViewer &&
      ["user", "presets", "noticeBoard"].includes(
        selectedAdminSection.key,
      ));
  const adminSectionGroups = [
    {
      key: "organization",
      label: "Organization",
      keys: ["workspace", "yearSetup", "divisions", "indentors"],
    },
    {
      key: "procurement",
      label: "Procurement Setup",
      keys: ["modes", "gemBiddingModes", "fileTypes", "firmTypes", "firms", "tcec", "fileMarkers", "milestones"],
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
      keys: ["user", "users", "ipAccess", "archive"],
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

  const setAdminSectionUnlocked = (key: string, unlocked: boolean) => {
    setUnlockedAdminSections((current) => ({ ...current, [key]: unlocked }));
  };

  return (
    <div className="space-y-4 max-w-none">
      <div className="rounded-md border border-border bg-secondary/40 px-4 py-3 text-sm">
        <div className="font-semibold">Protecting file history</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          Values used in active or archived file history may be locked against editing or deletion.
          Use the available edit, inactivate, or archive actions; historical references are kept.
        </div>
      </div>
      <div
        className={
          "grid grid-cols-1 gap-4 " +
          (settingsSidePanelHooked
          ? "lg:grid-cols-[260px_minmax(0,1fr)]"
            : "lg:grid-cols-[48px_minmax(0,1fr)]")
        }
      >
        {settingsSidePanelHooked ? (
          <aside className="rounded-xl border border-border bg-secondary/35 p-3 shadow-[var(--shadow-card)]">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Settings
              </div>
              <button
                type="button"
                onClick={() => setSettingsSidePanelHooked(false)}
                className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Unhook side panel"
              >
                Unhook
              </button>
            </div>
            <div className="max-h-[calc(100vh-12rem)] space-y-2 overflow-y-auto pr-1">
              {adminSectionGroups.map((group) => (
                <section
                  key={group.key}
                  className="overflow-hidden rounded-md border border-border bg-secondary/20"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedAdminGroup((current) =>
                        current === group.key ? "" : group.key,
                      )
                    }
                    aria-expanded={expandedAdminGroup === group.key}
                    className={
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition " +
                      (group.sections.some((section) => section.key === selectedAdminSection.key)
                        ? "bg-accent text-foreground"
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
                  {expandedAdminGroup === group.key ? (
                    <div className="space-y-1 border-t border-border bg-secondary/20 p-1.5">
                      {group.sections.map((section) => {
                        const selected = selectedAdminSection.key === section.key;
                        return (
                          <div key={section.key} className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  section.key !== activeAdminSection &&
                                  hasUnsavedAdminChanges &&
                                  !window.confirm("Discard unsaved settings changes and switch sections?")
                                ) return;
                                if (section.key === activeAdminSection) return;
                                setHasUnsavedAdminChanges(false);
                                setActiveAdminSection(section.key);
                              }}
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
                  ) : null}
                </section>
              ))}
            </div>
          </aside>
        ) : (
          <aside className="rounded-xl border border-border bg-secondary/35 p-2 shadow-[var(--shadow-card)]">
            <button
              type="button"
              onClick={() => setSettingsSidePanelHooked(true)}
              className="flex h-full min-h-40 w-full items-center justify-center rounded-md border border-dashed border-border bg-background px-1 py-3 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
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
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftPatch, setDraftPatch] = useState<Partial<AppSettings>>({});
  const savedSettings = useStoreSettings();
  const draftSettings = { ...savedSettings, ...draftPatch };
  const hasChanges = Object.keys(draftPatch).length > 0;

  const updateDraftSettings = (patch: Partial<AppSettings>) => {
    setDraftPatch((current) => ({ ...current, ...patch }));
    onDirtyChange(true);
    setSaveError("");
  };

  const saveChanges = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await store.saveSettings(draftPatch);
      setDraftPatch({});
      onDirtyChange(false);
      if (!hideUnlock) onLock();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const cancelChanges = () => {
    if (hasChanges && !window.confirm("Discard your unsaved settings changes?")) return;
    setDraftPatch({});
    onDirtyChange(false);
    setSaveError("");
    if (!hideUnlock) onLock();
  };

  const unlock = async () => {
    const password = await promptPassword(`Enter admin password to edit ${section.label}:`);
    if (password === null) return;
    if (!password.trim()) {
      window.alert("Password is required.");
      return;
    }
    setVerifying(true);
    try {
      await store.verifyAdminPassword(password);
      setDraftPatch({});
      onDirtyChange(false);
      setSaveError("");
      onUnlock();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Incorrect password.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      {unlocked ? (
        <div className="flex items-center justify-end gap-2">
          {saveError ? <p role="alert" className="mr-auto text-sm text-destructive">{saveError}</p> : null}
          <button
            type="button"
            onClick={cancelChanges}
            disabled={saving || (!hasChanges && hideUnlock)}
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
      ) : !hideUnlock ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void unlock()}
            disabled={verifying || saving}
            className={
              "h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium disabled:cursor-wait disabled:opacity-60 " +
              (unlocked
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background hover:bg-accent")
            }
          >
            <>
              <Lock className="size-4" /> Edit
            </>
          </button>
        </div>
      ) : null}
      <fieldset
        disabled={!unlocked || saving}
        className={
          !unlocked ? "pointer-events-none opacity-70 [&_*]:cursor-not-allowed" : undefined
        }
      >
        <SettingsDraftContext.Provider
          value={{ settings: draftSettings, updateSettings: updateDraftSettings }}
        >
          {!(["theme", "noticeBoard", "offsetDays"].includes(section.key)) ? (
            <div className="mb-3"><SettingsScope {...scopeInfo} /></div>
          ) : null}
          {section.content}
        </SettingsDraftContext.Provider>
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
      limits: "Protected actions may still require the configured deletion password.",
    },
    {
      role: "Sub-admin",
      can: "Work across divisions; edit records and settings enabled for this role.",
      limits: "Cannot manage user accounts or IP security settings.",
    },
    {
      role: "Editor",
      can: "Create and edit records in assigned divisions and permitted file categories.",
      limits: "Cannot manage user accounts or admin settings.",
    },
    {
      role: "Viewer",
      can: "View records in assigned divisions.",
      limits: "Cannot create or edit records.",
    },
    {
      role: "Division user",
      can: "View records in assigned divisions.",
      limits: "Cannot create or edit records.",
    },
    {
      role: "Universal Viewer",
      can: "View all divisions and add file-status notes. Cash Out Go scope can be view-only, personal, or global with MER.",
      limits: "Cannot edit core file records. Global Cash Out Go/MER edits affect everyone.",
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
                  <th scope="col" className="w-28 px-2 py-1.5 font-semibold">Role</th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Can do</th>
                  <th scope="col" className="px-2 py-1.5 font-semibold">Cannot do / limits</th>
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
            <p className="mt-2 max-w-[38rem] text-[11px] text-muted-foreground">
              Admin, Sub-admin, and Universal Viewer can access all divisions. Editor, Viewer, and Division user access is limited to assigned divisions; file-category limits apply to Editors.
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
  billsSubmitted?: SettingsCashOutGoRow[];
  billsAtHand?: SettingsCashOutGoRow[];
  deliveredBillsPending?: SettingsCashOutGoRow[];
  dpBasedForecast?: SettingsCashOutGoRow[];
  dpExpired?: SettingsCashOutGoRow[];
};

type SettingsCashOutGoRow = {
  rowKey: string;
  expectedSentDateOverride?: string;
  manualExpectedPaymentDate?: string;
  billOffsetOverride?: string;
};

function CashOutGoOffsetSettings({
  canEdit,
  scopeNote,
}: {
  canEdit: boolean;
  scopeNote: string;
}) {
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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

  const updateOffset = (key: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays", value: string) => {
    if (!plan) return;
    const defaultDays = key === "dpOffsetDays"
      ? plan.settings.defaultDpOffsetDays
      : key === "billOffsetDays"
        ? plan.settings.defaultBillOffsetDays
        : plan.settings.defaultHandSubmissionOffsetDays;
    const isPersonalScope =
      activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal";
    const enabledKey = key === "dpOffsetDays"
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
    setSaved(false);
  };

  const save = async () => {
    if (!plan || !canEdit) return;
    setSaving(true);
    setError("");
    const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const rows = [
      ...(plan.billsSubmitted ?? []),
      ...(plan.billsAtHand ?? []),
      ...(plan.deliveredBillsPending ?? []),
      ...(plan.dpBasedForecast ?? []),
      ...(plan.dpExpired ?? []),
    ].map((row) => ({
      rowKey: row.rowKey,
      expectedSentDate: row.expectedSentDateOverride,
      expectedPaymentDate: row.manualExpectedPaymentDate,
      billOffsetOverride: row.billOffsetOverride || "",
    }));
    try {
      const response = await fetch(`${apiBase}/api/reports/cash-out-go-plan`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plan.settings, rows }),
      });
      if (!response.ok) throw new Error("Cash Out Go offsets could not be saved.");
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Offsets could not be saved.");
    } finally {
      setSaving(false);
    }
  };

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
        {scopeNote} Save shared offsets to keep changes for future visits. They remain in effect until changed and saved again. Row-specific overrides remain separate where the report allows them.
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
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : <span />}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!plan || loading || saving || saved}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saved ? <Check className="size-4" /> : <Save className="size-4" />}
            {saving ? "Saving..." : saved ? "Saved" : "Save shared offsets"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">These values are view-only for this role; shared Cash Out Go offsets cannot be changed here.</p>
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

function PreferenceSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  return (
    <div className="space-y-5">
      <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold mb-1">UI theme</h2>
        <div className="mb-3">
          <SettingsScope scope="personal" editors="You" />
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Sets this account's display theme and colour order for bars, columns and pie charts.
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ThemeField
            label="Theme"
            value={settings.theme}
            onChange={(value) => updateSettings({ theme: value })}
          />
          <ThemeTintField
            label="Theme color"
            value={settings.themeTint}
            onChange={(value) => updateSettings({ themeTint: value })}
          />
          <ChartColorOrderField
            value={settings.chartColorOrder ?? chartColorOptions.map((option) => option.color)}
            onChange={(value) => updateSettings({ chartColorOrder: value })}
            disabled={settings.globalChartColorsEnforced === true}
          />
        </div>
      </div>
      {activeUser?.role === "admin" ? <GlobalChartColorSettings /> : null}
      <AddEditRibbonSettings />
    </div>
  );
}

function GlobalChartColorSettings() {
  const settings = useSettings();
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
      setMessage(error instanceof Error ? error.message : "Could not save the shared chart colours.");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Apply the default chart palette to everyone and prevent personal colour overrides?")) return;
    setSaving(true);
    setMessage("");
    try {
      await store.resetChartColorPreferencesForAllUsers();
      setMessage("Default palette applied to everyone. Users see it after their next refresh or sign-in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset chart colours for all users.");
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
        Set a shared order for every account. Bars, columns and pie slices use this order. Users see policy changes after their next refresh or sign-in. Reset applies the default order to everyone.
      </p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <ChartColorOrderField value={order} onChange={setOrder} />
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving..." : enforced ? "Apply to all users" : "Save colour policy"}
            </button>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Reset all users
            </button>
          </div>
          {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}

function AccountSettings() {
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const assignedDivisionNames =
    activeUser?.role === "sub_admin"
      ? "All divisions"
      : activeUser?.divisionIds
          .map((id) => divisions.find((division) => division.id === id)?.name)
          .filter(Boolean)
          .join(", ") || "No divisions assigned";

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

function AddEditRibbonSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const selected = normalizeAddEditRibbonFields(
    settings.addEditRibbonFields ?? defaultAddEditRibbonFields,
  );
  const updateField = (index: number, value: AddEditRibbonFieldKey) => {
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

function OffsetDaysSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const canEditPreSoOffsets =
    activeUser?.role === "admin" || activeUser?.role === "sub_admin";
  const canEditCashOutGoOffsets =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    (activeUser?.role === "universal_viewer" &&
      (activeUser.cashOutgoEditScope === "personal" ||
        activeUser.cashOutgoEditScope === "global"));
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
        "Admin/Sub-admin changes apply throughout the software.",
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
            <SettingsScope scope="shared" editors="Administrators and Sub-admins" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shared offsets and the Delay Status default apply across Analytics and Reports; report-level overrides remain separate where available.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {offsets.map((offset) => (
            <label key={offset.label} className="block rounded-md border border-border bg-background p-3">
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
                  <span key={line} className="block">{line}</span>
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
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const [selectedYearFileCount, setSelectedYearFileCount] = useState(-1);
  const [yearUsageError, setYearUsageError] = useState("");
  const [yearUsageRetry, setYearUsageRetry] = useState(0);
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
          setYearUsageError("Could not check whether this year has files. Retry before deleting it.");
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
              <SearchableDropdown
                value={workspaceYear}
                onChange={(year) => setWorkspaceYear(year || settings.financialYear)}
                options={[]}
                optionItems={financialYears.map((year) => ({
                  value: year,
                  label: displayFinancialYearLabel(year),
                }))}
                placeholder="Select financial year"
                deferChangeUntilSelect
                allowCustomValue={false}
                disabled={!canEditWorkspaceGlobals}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
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
            </div>
          </div>
        </div>
        <ThemeField
          label="Theme"
          value={settings.theme}
          onChange={(value) => updateSettings({ theme: value })}
        />
        <ThemeTintField
          label="Theme color"
          value={settings.themeTint}
          onChange={(value) => updateSettings({ themeTint: value })}
        />
        <PasswordField
          label="Deletion password"
          value={settings.deletionPassword}
          onChange={(value) => {
            if (canEditWorkspaceGlobals) updateSettings({ deletionPassword: value });
          }}
          disabled={!canEditWorkspaceGlobals}
          helper={deletionPasswordHelper}
        />
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
                  <input
                    value={row.value}
                    onChange={(event) => rename(index, event.target.value)}
                    disabled={usedFirmType}
                    title={usedFirmType ? "Used firm type cannot be renamed. Inactivate it to hide from future dropdowns." : undefined}
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
  const rows = getMasterValueUsageRows(modes, getModeUsage(files), { uppercase: true });

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
    if (isDefaultMode(modes[index])) return;
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
                    <input
                      value={row.value}
                      onChange={(event) => rename(index, event.target.value)}
                      disabled={lockedModeName}
                      title={usedMode ? "Used mode cannot be renamed. Inactivate it to hide from future dropdowns." : undefined}
                      className={
                        "h-9 w-full min-w-0 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (lockedModeName ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                      }
                    />
                    <MasterValueMeta row={row} />
                  </div>
                  {protectedMode ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
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
          const isBuiltIn = ["Custom", "Catalogue", "Comparison"].includes(mode);
          const cannotDelete = usageCount > 0 || isBuiltIn;
          return (
          <li key={mode} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-sm">
              {mode}
              {usageCount > 0 ? (
                <span className="ml-2 text-xs text-muted-foreground">Used by {usageCount} file{usageCount === 1 ? "" : "s"}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => updateSettings({ gemBiddingModes: modes.filter((item) => item !== mode) })}
              disabled={cannotDelete}
              className="grid size-8 shrink-0 place-items-center rounded-md text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Delete ${mode} GeM bidding mode`}
              title={usageCount > 0 ? `In use by ${usageCount} file${usageCount === 1 ? "" : "s"}` : isBuiltIn ? "Built-in modes cannot be removed" : `Delete ${mode}`}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

function normalizeGemBiddingModes(values: string[] | undefined) {
  const defaults = ["Custom", "Catalogue", "Comparison"];
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

function FileTypeSettings() {
  const settings = useSettings();
  const updateSettings = useSettingsUpdater();
  const activeUser = useActiveUser();
  const files = useSettingsUsageFiles();
  const [name, setName] = useState("");
  const [newFileTypeGroup, setNewFileTypeGroup] = useState<FileTypeGroup | "">("");
  const fileTypes = normalizeFileTypes(settings.fileTypes);
  const fileTypeGroups = normalizeFileTypeGroups(settings.fileTypeGroups, fileTypes);
  const rows = getMasterValueUsageRows(fileTypes, getFileTypeUsage(files));

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
    if (isDefaultFileType(fileTypes[index])) return;
    const removed = fileTypes[index];
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
          <SettingsHelper items={settingsControlHelpers.fileTypeGroup} label="File type group help" />
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
	              const protectedFileType = isDefaultFileType(fileType) || usedFileType;
	              return (
                <li
                  key={`${fileType}-${index}`}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px_auto]"
                >
                  <div>
                    <input
                      value={fileType}
                      onChange={(event) => rename(index, event.target.value)}
	                      disabled={protectedFileType}
                      className={
                        "h-9 w-full min-w-0 flex-1 rounded-md border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 " +
                        (protectedFileType
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
	                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
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
                  <input
                    value={row.marker.code}
                    onChange={(event) => rename(index, event.target.value)}
                    disabled={usedMarker}
                    title={usedMarker ? "Used marker code cannot be renamed. Inactivate it to hide from future dropdowns." : undefined}
                    className={
                      "h-9 w-full min-w-0 rounded-md border border-input px-3 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-ring/40 " +
                      (usedMarker ? "bg-secondary/50 text-muted-foreground" : "bg-background")
                    }
                  />
                  <MasterValueMeta row={row} />
                </div>
                <input
                  value={row.marker.description}
                  onChange={(event) => updateDescription(index, event.target.value)}
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
                  <div className="text-sm font-semibold text-muted-foreground">{row.marker.code}</div>
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
      ranges.filter((range): range is { label: string; min?: number; max?: number } => !("error" in range)),
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
  files.forEach((file) => addUsage(usage, file.id, file.gemBiddingMode));
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
  files.forEach((file) => addUsage(usage, file.id, file.indentor));
  return usage;
}

function getFirmUsageCount(firm: MasterFirm, usage: Map<string, { value: string; fileIds: Set<string> }>) {
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
  const activeKeys = new Set(activeValues.map((value) => normalizeMasterKey(value, options.uppercase)));
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
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
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
        disabled
        className="inline-flex h-8 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground opacity-70"
        aria-label={`Cannot remove ${label}; it is in use`}
        title={`Used in ${row.usageCount} file${row.usageCount === 1 ? "" : "s"} including Archive. Remove or update those references first.`}
      >
        <Lock className="size-3.5" /> In use
      </button>
    );
  }

  return (
    <HelpedControl helper={settingsControlHelpers.genericDelete} label={`Delete ${label} help`}>
      <button
        type="button"
        onClick={onDelete}
        className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
        aria-label={`Delete ${label}`}
      >
        <Trash2 className="size-4" />
      </button>
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
          onClick={() => void save()}
          disabled={!thresholdsChanged || saving}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="size-4" /> {saving ? "Saving..." : "Save thresholds"}
        </button>
      </div>
    </div>
  );
}

const defaultBgReceiptDelayDays = [10, 30, 60];

function normalizeBgReceiptDelaySettings(value: number[] | undefined) {
  const thresholds = Array.from(
    new Set(
      (value ?? defaultBgReceiptDelayDays).filter(
        (days) => Number.isInteger(days) && days >= 0,
      ),
    ),
  )
    .sort((left, right) => left - right)
    .slice(0, 6);
  return thresholds.length ? thresholds : defaultBgReceiptDelayDays;
}

function BgReceiptDelaySettings() {
  const settings = useSettings();
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
    valid &&
    JSON.stringify([...normalized].sort((a, b) => a - b)) !== JSON.stringify(savedDays);

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
            <input
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
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground" role="status">{message}</div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving || days.length >= 6}
            onClick={() => setDays((current) => [...current, String((Number(current.at(-1)) || 0) + 30)])}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Add threshold
          </button>
          <button
            type="button"
            disabled={saving || days.length <= 1}
            onClick={() => setDays((current) => current.slice(0, -1))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Remove last
          </button>
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
            disabled={saving || JSON.stringify(savedDays) === JSON.stringify(defaultBgReceiptDelayDays)}
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
        <p className="mt-2 text-xs text-destructive">Thresholds must be distinct, non-negative whole numbers.</p>
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
      const [acceptancePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        store.listSuspectedAnomalies(settings.selectedYear),
      ]);
      setAcceptances(acceptancePayload.acceptances);
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
  const formatScope = (scope: string | undefined) =>
    scope === "universal" ? "Universal" : "File";

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
    const password = await promptPassword("Enter your account password to clear selected anomalies:");
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

  const currentAnomalies = activeAnomalies.filter((row) => row.requestStatus !== "pending");
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
                      {row.previousField ? `${row.previousField}: ` : ""}{row.previousDate || "-"}
                    </div>
                    <div>
                      {row.laterField ? `${row.laterField}: ` : ""}{row.laterDate || "-"}
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
          Review user acceptance requests and approve file-specific or universal exceptions.
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
  const rows = getMasterValueUsageRows(milestones, getMilestoneUsage(files));
  const protectedMilestoneKeys = useMemo(
    () => new Set([normalizeMilestoneName(fileClosedMilestone)]),
    [],
  );
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
        Controls the active milestone order on file boards and in Dashboard Status-2 and Status-4.
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
                        disabled={activeIndex === 0}
                        className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`Move ${milestone} up`}
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(activeIndex, 1)}
                        disabled={activeIndex === milestones.length - 1}
                        className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`Move ${milestone} down`}
                      >
                        <ArrowDown className="size-4" />
                      </button>
                    </>
                  ) : null}
                  {protectedMilestoneKeys.has(normalizeMilestoneName(milestone)) ? (
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground">
                      Existing
                    </span>
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
            <SettingsHelper items={settingsSectionHelpers.presets} label="Preset table fields help" />
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
  const presets = normalizeDemandProcessingPresets(settings.demandProcessingPresets);
  const dayRanges = normalizeDemandProcessingDayRanges(settings.demandProcessingDayRanges);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "");
  const [dayRangeMessage, setDayRangeMessage] = useState("");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];

  useEffect(() => {
    if (!selectedPreset && presets[0]) setSelectedPresetId(presets[0].id);
  }, [presets, selectedPreset]);

  const updatePresets = (next: DemandProcessingPreset[]) => {
    updateSettings({ demandProcessingPresets: next });
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
    const normalized = normalizeDemandProcessingDayRanges(next);
    const message = validateDemandProcessingDayRanges(normalized);
    setDayRangeMessage(message);
    if (message) return;
    updateSettings({ demandProcessingDayRanges: normalized });
  };
  const updateDayRange = (id: string, patch: Partial<DemandProcessingDayRange>) => {
    updateDayRanges(dayRanges.map((range) => (range.id === id ? { ...range, ...patch } : range)));
  };
  const addDayRange = () => {
    const lastRange = dayRanges[dayRanges.length - 1];
    const lastMax = Number(String(lastRange?.maxDays ?? "").trim());
    const nextMin = Number.isInteger(lastMax) && lastMax >= 0 ? String(lastMax + 1) : "";
    updateDayRanges([
      ...dayRanges,
      {
        id: crypto.randomUUID(),
        label: `Range ${dayRanges.length + 1}`,
        minDays: nextMin,
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
      <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
        message={dayRangeMessage}
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
    .filter((range): range is NonNullable<typeof range> => range !== undefined);
  return ranges.length ? ranges : defaultDemandProcessingDayRanges;
}

function validateDemandProcessingDayRanges(ranges: DemandProcessingDayRange[]) {
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
    parsed.filter((range): range is { label: string; min: number; max?: number } => !("error" in range)),
    1,
  );
}

function DemandProcessingDayRangeSettings({
  ranges,
  message,
  onAdd,
  onReset,
  onUpdate,
  onRemove,
}: {
  ranges: DemandProcessingDayRange[];
  message?: string;
  onAdd: () => void;
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
            These ranges group results in Reports &gt; Demand processing analysis.
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
	      {message ? (
	        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
	          {message}
	        </p>
	      ) : null}
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
    store.addDivision(name.trim(), code.trim() || undefined);
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
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
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
                      <input
                        type="password"
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
  "firmName" | "firmType" | "firmTypeOther" | "emailId" | "city" | "address" | "firmUniqueNo" | "contactNo"
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
    firmTypeOther: draft.firmType?.trim().toUpperCase() === "OTHER" ? draft.firmTypeOther?.trim() || "" : "",
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
  const updateSettings = useSettingsUpdater();
  const config = normalizeFirmRatingConfig(settings.firmRatingConfig);

  const updateFields = (fields: FirmRatingConfig["fields"]) => {
    updateSettings({ firmRatingConfig: normalizeFirmRatingConfig({ fields }) });
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
  const updateSettings = useSettingsUpdater();
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
  const [labelDraft, setLabelDraft] = useState(settings.firmUniqueNoLabel || "Firm Unique No.");
  const firmUniqueNoLabel = settings.firmUniqueNoLabel || "Firm Unique No.";
  const firmTypeOptions = normalizeFirmTypes([
    ...normalizeFirmTypes(settings.firmTypes),
    "Other",
  ]);
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
    return Boolean(
      cleaned.firmName &&
      (cleaned.firmType?.toUpperCase() !== "OTHER" || cleaned.firmTypeOther),
    );
  };

  const updateDraft = (key: keyof FirmDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const updateEditDraft = (key: keyof FirmDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };
  const addFirmType = (value: string, target: "new" | "edit") => {
    const trimmed = value.trim();
    if (!canManageFirmTypes || !trimmed) return;
    const existing = firmTypeOptions.find(
      (firmType) => firmType.toLowerCase() === trimmed.toLowerCase(),
    );
    const selected = existing ?? trimmed;
    if (!existing) {
      updateSettings({ firmTypes: normalizeFirmTypes([...firmTypeOptions, trimmed]) });
    }
    if (target === "new") updateDraft("firmType", selected);
    else updateEditDraft("firmType", selected);
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
      setMessage("Firm deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete firm.");
    }
  };

  const saveFirmUniqueNoLabel = async () => {
    if (activeUser?.role !== "admin") return;
    await store.saveSettings({ firmUniqueNoLabel: labelDraft.trim() || "Firm Unique No." });
  };

  return (
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Firm Database</h2>
          <p className="text-xs text-muted-foreground">
            Edit only for same-firm corrections. Delete is available only when no files/S.O.s use
            the firm name or unique number.
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

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1fr_0.85fr_1fr_1fr_0.8fr_0.9fr_0.9fr_auto]">
        <DivisionInput
          value={draft.firmName ?? ""}
          onChange={(value) => updateDraft("firmName", value)}
          placeholder="Firm name *"
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
              placeholder="Specify firm type"
              invalid={!draft.firmTypeOther?.trim()}
            />
          ) : null}
        </div>
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
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1120px] table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[8%]" />
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
                            onAddType={canManageFirmTypes ? (value) => addFirmType(value, "edit") : undefined}
                          />
                          {editDraft.firmType?.toUpperCase() === "OTHER" ? (
                            <FirmInput
                              value={editDraft.firmTypeOther ?? ""}
                              onChange={(value) => updateEditDraft("firmTypeOther", value)}
                              placeholder="Specify firm type"
                              invalid={!editDraft.firmTypeOther?.trim()}
                            />
                          ) : null}
                        </div>
                      ) : (
                        [firm.firmType, firm.firmType?.toUpperCase() === "OTHER" ? firm.firmTypeOther : ""]
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
	                                  className="inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground opacity-70"
	                                >
	                                  Used
	                                </button>
	                              ) : (
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
}: {
  editing: boolean;
  value?: string;
  onChange: (value: string) => void;
  type?: string;
  invalid?: boolean;
  options?: string[];
  displayWidth?: number;
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
            placeholder=""
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
            <input
              autoFocus
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
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

  const isReadyToSave = (value: IndentorDraft) =>
    Boolean(value.divisionId && value.name.trim());

  const resetDraft = () =>
    setDraft({ ...emptyIndentorDraft, divisionId: availableDivisions[0]?.id ?? "" });

  const addIndentor = async () => {
    if (!isReadyToSave(draft)) return;
    if (
      activeUser?.role === "viewer" &&
      !window.confirm(
        "Please confirm the division and name are correct. Other details can be completed later by an admin or sub-admin. Once added, a viewer cannot edit or delete this indentor.",
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
	          <h2 className="text-sm font-semibold mb-1">Indentors</h2>
	          <p className="text-xs text-muted-foreground">
	            Add and search division-wise indentors used when files are created.
	          </p>
	          <p className="mt-1 text-xs text-muted-foreground">
	            Division and Name are required. Other details may be left blank and completed later
	            by an admin or sub-admin.
	          </p>
          <p className="mt-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Editing changes the indentor master record only. Existing file records keep the
            indentor name and division saved on them.
          </p>
	        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row">
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
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
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
          disabled={!isReadyToSave(draft)}
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
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
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
                  indentorUsage.get(normalizeMasterKey(indentor.name))?.fileIds.size ?? 0;
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

      <div className="rounded-md border border-border bg-secondary/35 p-5 shadow-[var(--shadow-card)]">
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold">
        Authorised users
        <AuthorisedUserRolesTooltip />
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add users and assign the divisions they should be allowed to work with.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="User name" />
        <DivisionInput value={username} onChange={setUsername} placeholder="Username" />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
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
                          <input
                            type="password"
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
    <div className="bg-secondary/35 border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
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
                    <td className="px-4 py-3 font-medium">
                      <CompactTableText value={firm.firmName || "Not set"} width={20} />
                    </td>
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
  options: readonly FileCategoryOption[] = fileCategoryOptions,
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
    ...chartColorOptions
      .map((option) => option.color)
      .filter((color) => !value.includes(color)),
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
      <legend className="mb-1.5 text-xs font-medium">Chart colour priority for bars, columns and pie charts</legend>
      <p className="mb-2 text-xs text-muted-foreground">
        {disabled
          ? "An administrator is setting the colour order for all users."
          : "Saved to your account. Bars, columns and pie slices use colours from top to bottom, as needed."}
      </p>
      <ol className="space-y-1">
        {orderedColors.map((color, index) => {
          const option = chartColorOptions.find((item) => item.color === color)!;
          return (
            <li key={color} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="size-4 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: color }} />
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
