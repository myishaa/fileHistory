// Backend-backed store for files, divisions, users, and settings.
import * as React from "react";
import type { MmgSummaryFieldConfig } from "@/lib/mmg-summary";
import type { DemandProcessingPreset } from "@/lib/demand-processing-analysis";
import { defaultTableFieldPresets, type TableFieldPreset } from "@/lib/table-field-presets";
import type { FileTypeGroup, FileTypeGroupSetting } from "@/lib/file-type-groups";
import {
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isFileVisibleForYear,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";

export type FileRecord = {
  id: string;
  title?: string;
  division?: string;
  officer?: string;
  imms?: string;
  date?: string; // ISO yyyy-mm-dd
  year?: string;
  activeYears?: string[];
  uniqueCode?: string;
  receivedDate?: string;
  scrutinyDate?: string;
  scrutinyResponseDate?: string;
  scrutinyCompletionDate?: string;
  immsDate?: string;
  fileNo?: string;
  indentor?: string;
  demandDescription?: string;
  valueCapital?: string;
  valueRevenue?: string;
  currency?: string;
  exchangeRate?: string;
  gte?: string;
  tcec?: string;
  fileType?: string;
  fileTypeGroup?: FileTypeGroup;
  mode?: string;
  gem?: string;
  gemBiddingMode?: string;
  highValue?: string;
  ad?: string;
  rqa?: string;
  ifa?: string;
  psb?: string;
  bg?: string;
  ir?: string;
  rfpVetting?: string;
  highValueMeetingDate?: string;
  highValueMinutesDate?: string;
  adSentDate?: string;
  preTcecDate?: string;
  preTcecMinutesDate?: string;
  preTcecCommitteeNo?: string;
  adVettingDate?: string;
  rqaSentDate?: string;
  rqaApprovalDate?: string;
  ifaSentDate?: string;
  ifaFinalDate?: string;
  cfaSentDate?: string;
  cfaDate?: string;
  gemUndertakingDate?: string;
  rfpVettingInitiationDate?: string;
  rfpVettingApprovalDate?: string;
  preBidMeeting?: string;
  preBidMeetingDate?: string;
  tenderLive?: string;
  bidNumber?: string;
  bidDate?: string;
  bidOpeningDate?: string;
  bidOpened?: string;
  refloat?: string;
  refloatPreBidMeeting?: string;
  refloatPreBidMeetingDate?: string;
  postTcecDate?: string;
  postTcecMinutesDate?: string;
  postTcecCommitteeNumber?: string;
  refloatBiddingDate?: string;
  refloatBidOpeningDate?: string;
  refloatPostTcecDate?: string;
  refloatPostTcecMinutesDate?: string;
  refloatPostTcecCommitteeNo?: string;
  rst?: string;
  biddingStageOver?: string;
  cncDate?: string;
  cncApprovalDate?: string;
  noOfSo?: string;
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  billAmountCapital?: string;
  billAmountRevenue?: string;
  dpDate?: string;
  firm?: string;
  bqBasis?: string;
  firmUniqueNo?: string;
  firmContactNo?: string;
  firmCity?: string;
  firmType?: string;
  firmTypeOther?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  ldType?: string;
  ldPercentage?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  jobCompletionDate?: string;
  irPreparationDate?: string;
  irReceiptDate?: string;
  billPreparationDate?: string;
  billSentForPaymentDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
  demandCancelled?: string;
  demandCancelledDate?: string;
  soCancelled?: string;
  soCancelledDate?: string;
  shortclosure?: string;
  shortclosureDate?: string;
  bqFirms?: FirmDetail[];
  invitedFirms?: FirmDetail[];
  bidderFirms?: FirmDetail[];
  supplyOrders?: SupplyOrderDetail[];
  remarks?: FileRemark[];
  markers?: FileMarker[];
  currentMilestone?: string;
  completedMilestones?: string[];
  fileClosureDate?: string;
  createdAt: string;
};

export type FileRemark = {
  id: string;
  section: string;
  text: string;
  createdAt: string;
};

export type FileMarker = {
  id: string;
  text: string;
  createdAt: string;
};

export type FileMessageReply = {
  id: string;
  messageId: string;
  text: string;
  createdByName: string;
  createdByRole: string;
  createdAt: string;
};

export type FileMessage = {
  id: string;
  fileId: string;
  divisionId?: string;
  divisionName: string;
  fileUniqueCode?: string;
  fileNo?: string;
  imms?: string;
  section: string;
  text: string;
  status: "pending" | "resolved";
  createdByName: string;
  createdByRole: string;
  createdAt: string;
  resolvedByName?: string;
  resolvedAt?: string;
  viewedAt?: string;
  replies: FileMessageReply[];
};

export type FileProcessingChange = {
  field: string;
  label: string;
  oldValue?: string;
  newValue?: string;
  action: "entered" | "cleared" | "changed";
};

export type FileProcessingNotification = {
  id: string;
  fileId: string;
  divisionId?: string;
  divisionName: string;
  fileUniqueCode?: string;
  fileNo?: string;
  imms?: string;
  changedByName: string;
  changedByRole: string;
  changes: FileProcessingChange[];
  summary: string;
  status: "pending" | "acknowledged";
  acknowledgedByName?: string;
  acknowledgedAt?: string;
  createdAt: string;
};

export type BillReturnCycle = {
  returnedDate?: string;
  reason?: string;
  resubmittedDate?: string;
  remarks?: string;
};

export type FileStatusUpdate = {
  id: string;
  fileId: string;
  divisionId?: string;
  text: string;
  createdByName: string;
  createdByRole: string;
  createdAt: string;
  updatedByName?: string;
  updatedAt?: string;
  canEdit?: boolean;
};

export type QuickStatusFileSummary = {
  id: string;
  uniqueCode?: string;
  controlNo?: string;
  itemDescription?: string;
  division?: string;
  indentor?: string;
  receivedDate?: string;
};

export type SupplyOrderDetail = {
  currentMilestone?: string;
  completedMilestones?: string[];
  financialSanctionDate?: string;
  psbApplicable?: string;
  bgCoverageType?: string;
  psbBgNo?: string;
  psbBgAmount?: string;
  psbBgReceivedDate?: string;
  psbBgValidityDate?: string;
  psbBgReturnDate?: string;
  pwbBgNo?: string;
  pwbBgAmount?: string;
  pwbBgReceivedDate?: string;
  pwbBgValidityDate?: string;
  pwbBgReturnDate?: string;
  combinedBgNo?: string;
  combinedBgAmount?: string;
  combinedBgReceivedDate?: string;
  combinedBgValidityDate?: string;
  combinedBgReturnDate?: string;
  warrantyPeriodDate?: string;
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  billAmountCapital?: string;
  billAmountRevenue?: string;
  dpDate?: string;
  firm?: string;
  firmUniqueNo?: string;
  firmContactNo?: string;
  firmCity?: string;
  firmType?: string;
  firmTypeOther?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  ldType?: string;
  ldPercentage?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  jobCompletionDate?: string;
  irPreparationDate?: string;
  irReceiptDate?: string;
  billPreparationDate?: string;
  billSentForPaymentDate?: string;
  billReturnCycles?: BillReturnCycle[];
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
  demandCancelled?: string;
  soCancelled?: string;
  soCancelledDate?: string;
  shortclosure?: string;
  shortclosureDate?: string;
  stageDelivery?: string;
  stageDeliveryCount?: string;
  stagePayment?: string;
  advancePayment?: string;
  advancePaymentDetail?: AdvancePaymentDetail;
  deliveryPeriodStartDate?: string;
  stageDeliveryLabel?: string;
  stageDeliveries?: StageDeliveryDetail[];
  firmRatingValues?: Record<string, string>;
};

export type AdvancePaymentDetail = {
  currentMilestone?: string;
  completedMilestones?: string[];
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
  billPreparationDate?: string;
  billSentForPaymentDate?: string;
  billReturnCycles?: BillReturnCycle[];
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
};

export type StageDeliveryDetail = {
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
  currentMilestone?: string;
  completedMilestones?: string[];
  deliveryPeriodStartDate?: string;
  dpDate?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  irPreparationDate?: string;
  irReceiptDate?: string;
  billPreparationDate?: string;
  billSentForPaymentDate?: string;
  billReturnCycles?: BillReturnCycle[];
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
};

export type FirmDetail = {
  firmName?: string;
  city?: string;
  address?: string;
  emailId?: string;
  firmUniqueNo?: string;
  contactNo?: string;
};

export type Division = {
  id: string;
  name: string;
  code?: string;
  allocatedCapital?: string;
  allocatedRevenue?: string;
  ad?: string;
  messagesEnabled?: boolean;
  active?: boolean;
  archivedAt?: string;
};
export type Indentor = {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  sfId: string;
  designation: string;
  mobileNo: string;
  landlineNo: string;
  email: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
};
export type IndentorSearchResult = {
  indentors: Indentor[];
  total: number;
  page: number;
  pageSize: number;
};
export type MasterFirm = {
  id: string;
  firmName?: string;
  emailId?: string;
  city?: string;
  address?: string;
  firmUniqueNo?: string;
  contactNo?: string;
  firmRating?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
};
export type MasterFirmSearchResult = {
  firms: MasterFirm[];
  total: number;
  page: number;
  pageSize: number;
};
export type DivisionMergePayload = {
  financialYear: string;
  sourceDivisionIds: string[];
  targetDivisionId?: string;
  targetDivisionName?: string;
  targetDivisionCode?: string;
  effectiveDate?: string;
  notes?: string;
  moveActiveFiles: boolean;
  deactivateSourceDivisions: boolean;
};
export type DivisionSplitTransferPayload = {
  financialYear: string;
  sourceDivisionId: string;
  indentorIds: string[];
  targetDivisionId?: string;
  targetDivisionName?: string;
  targetDivisionCode?: string;
  allocatedCapital: string;
  allocatedRevenue: string;
  effectiveDate?: string;
  notes?: string;
  deactivateSourceDivision: boolean;
};
export type AppUserRole =
  | "admin"
  | "sub_admin"
  | "division_user"
  | "editor"
  | "viewer"
  | "universal_viewer";
export type AppUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
  allowedFileCategories?: string[] | null;
};
export type AppTheme = "light" | "dark";
export type AppThemeTint = "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
export type ValueThresholdAppliesTo = "capital" | "revenue" | "both";
export type ValueThresholdLevel = {
  id?: string;
  label: string;
  levelNumber: number;
  minValue?: string;
  maxValue?: string;
  appliesTo: ValueThresholdAppliesTo;
};
export type FirmRatingField = {
  id: string;
  label: string;
  weight?: string;
};
export type FirmRatingConfig = {
  fields: FirmRatingField[];
};
export type DemandProcessingDayRange = {
  id?: string;
  label: string;
  minDays?: string;
  maxDays?: string;
};
export type SpecialFileMarker = {
  code: string;
  description: string;
};
export type AppSettings = {
  financialYear: string;
  selectedYear: string;
  financialYears: string[];
  yearSelectionLocked: boolean;
  theme: AppTheme;
  themeTint: AppThemeTint;
  deletionPassword: string;
  tcecCommittees: string[];
  firmTypes: string[];
  fileTypes: string[];
  fileTypeGroups: FileTypeGroupSetting[];
  modes: string[];
  valueThresholdLevels: ValueThresholdLevel[];
  milestones: string[];
  tableFieldPresets: TableFieldPreset[];
  liveStatusLockedFields?: string[];
  mmgLiveEnabled?: boolean;
  mmgLiveOptions?: string[];
  mmgSummaryFields?: MmgSummaryFieldConfig[];
  demandProcessingPresets?: DemandProcessingPreset[];
  demandProcessingDayRanges?: DemandProcessingDayRange[];
  bgReceiptDelayDays?: number[];
  specialFileMarkers?: SpecialFileMarker[];
  firmUniqueNoLabel?: string;
  firmRatingConfig?: FirmRatingConfig;
  activeUserId?: string;
};

function currentYear() {
  const startYear = new Date().getFullYear();
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const defaultSettings: AppSettings = {
  financialYear: currentYear(),
  selectedYear: "__active_plus_current_fy_closed__",
  financialYears: [currentYear()],
  yearSelectionLocked: false,
  theme: "light",
  themeTint: "plain",
  deletionPassword: "",
  tcecCommittees: [],
  firmTypes: ["MSE", "MSE (Women)", "Non-MSE"],
  fileTypes: ["Goods & Services", "AMC", "MPC", "CARS", "O&M"],
  fileTypeGroups: [
    { fileType: "Goods & Services", group: "goodsServices" },
    { fileType: "AMC", group: "contract" },
    { fileType: "MPC", group: "contract" },
    { fileType: "CARS", group: "contract" },
    { fileType: "O&M", group: "contract" },
  ],
  modes: ["OBM", "PBM", "SBM", "LBM", "LPC"],
  valueThresholdLevels: [],
  milestones: [],
  tableFieldPresets: defaultTableFieldPresets,
  mmgLiveEnabled: false,
  mmgLiveOptions: [],
  mmgSummaryFields: [],
  demandProcessingPresets: [],
  demandProcessingDayRanges: [
    { id: "0-90", label: "0-90", minDays: "0", maxDays: "90" },
    { id: "91-180", label: "91-180", minDays: "91", maxDays: "180" },
    { id: "181-365", label: "181-365", minDays: "181", maxDays: "365" },
    { id: "365-plus", label: "365 and above", minDays: "366", maxDays: "" },
  ],
  bgReceiptDelayDays: [10, 30, 60],
  specialFileMarkers: [],
  firmUniqueNoLabel: "Firm Unique No.",
  firmRatingConfig: {
    fields: [
      { id: "delivery", label: "Delivery", weight: "1" },
      { id: "quality", label: "Quality", weight: "1" },
      { id: "afterSalesService", label: "After Sales Service", weight: "1" },
    ],
  },
};

const defaultUsers: AppUser[] = [];

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type StoreState = {
  files: FileRecord[];
  messages: FileMessage[];
  fileProcessingNotifications: FileProcessingNotification[];
  divisions: Division[];
  indentors: Indentor[];
  settings: AppSettings;
  users: AppUser[];
  authUser?: AppUser;
  loading: boolean;
  loaded: boolean;
  error?: string;
};

let state: StoreState = {
  files: [],
  messages: [],
  fileProcessingNotifications: [],
  divisions: [],
  indentors: [],
  settings: defaultSettings,
  users: defaultUsers,
  authUser: undefined,
  loading: false,
  loaded: false,
};

let loadPromise: Promise<void> | undefined;

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  emit();
}

function upsertFile(files: FileRecord[], file: FileRecord) {
  return files.some((current) => current.id === file.id)
    ? files.map((current) => (current.id === file.id ? file : current))
    : [file, ...files];
}

function upsertMessage(messages: FileMessage[], message: FileMessage) {
  return messages.some((current) => current.id === message.id)
    ? messages.map((current) => (current.id === message.id ? message : current))
    : [message, ...messages];
}

function upsertFileProcessingNotification(
  notifications: FileProcessingNotification[],
  notification: FileProcessingNotification,
) {
  return notifications.some((current) => current.id === notification.id)
    ? notifications.map((current) => (current.id === notification.id ? notification : current))
    : [notification, ...notifications];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep the status-based message if the backend did not send JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function divisionsPath(year?: string, includeInactive = false) {
  const params = new URLSearchParams();
  const divisionYear =
    isAllActiveFilesYear(year) || isActivePlusCurrentFyClosedYear(year)
      ? state.settings.financialYear
      : year;
  if (divisionYear) params.set("year", divisionYear);
  if (includeInactive) params.set("includeInactive", "true");
  const query = params.toString();
  return query ? `/api/divisions?${query}` : "/api/divisions";
}

function filesPath(year?: string) {
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  const query = params.toString();
  return query ? `/api/files?${query}` : "/api/files";
}

function normalizeSettingsYears(settings: AppSettings): AppSettings {
  const financialYear =
    normalizeFinancialYearLabel(settings.financialYear) ||
    normalizeFinancialYearLabel(defaultSettings.financialYear);
  const selectedYear =
    isAllActiveFilesYear(settings.selectedYear) ||
    isActivePlusCurrentFyClosedYear(settings.selectedYear)
      ? settings.selectedYear
      : normalizeFinancialYearLabel(settings.selectedYear) || financialYear;
  const financialYears = Array.from(
    new Set(
      [financialYear, selectedYear, ...(settings.financialYears ?? [])]
        .map((year) =>
          isAllActiveFilesYear(year) || isActivePlusCurrentFyClosedYear(year)
            ? undefined
            : normalizeFinancialYearLabel(year),
        )
        .filter((year): year is string => Boolean(year)),
    ),
  );
  return {
    ...settings,
    financialYear,
    selectedYear,
    financialYears,
  };
}

async function loadAll(force = false) {
  if (typeof window === "undefined") return;
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    setState({ loading: true, error: undefined });
    try {
      const auth = await request<{ user: AppUser | null }>("/api/auth/me");
      if (!auth.user) {
        const settings = await request<{ settings: AppSettings }>("/api/settings");
        const divisions = await request<{ divisions: Division[] }>(
          divisionsPath(settings.settings.selectedYear),
        );
        setState({
          files: [],
          messages: [],
          fileProcessingNotifications: [],
          divisions: divisions.divisions,
          indentors: [],
          users: [],
          authUser: undefined,
          settings: normalizeSettingsYears({
            ...defaultSettings,
            ...settings.settings,
            tableFieldPresets: settings.settings.tableFieldPresets?.length
              ? settings.settings.tableFieldPresets
              : defaultTableFieldPresets,
          }),
          loading: false,
          loaded: true,
        });
        return;
      }

      const settings = await request<{ settings: AppSettings }>("/api/settings");
      const baseRequests = [
        request<{ divisions: Division[] }>(divisionsPath(settings.settings.selectedYear)),
        request<{ messages: FileMessage[] }>("/api/messages"),
        request<{ notifications: FileProcessingNotification[] }>("/api/messages/file-processing"),
      ] as const;
      const [divisions, messages, fileProcessingNotifications] = await Promise.all(baseRequests);
      const users =
        auth.user.role === "admin" || auth.user.role === "universal_viewer"
          ? await request<{ users: AppUser[] }>("/api/users")
          : { users: [auth.user] };

      setState({
        files: [],
        messages: messages.messages,
        fileProcessingNotifications: fileProcessingNotifications.notifications,
        divisions: divisions.divisions,
        indentors: [],
        users: users.users,
        authUser: auth.user,
        settings: normalizeSettingsYears({
          ...defaultSettings,
          ...settings.settings,
          activeUserId: auth.user.id,
          tableFieldPresets: settings.settings.tableFieldPresets?.length
            ? settings.settings.tableFieldPresets
            : defaultTableFieldPresets,
        }),
        loading: false,
        loaded: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load backend data.";
      console.error(error);
      setState({ loading: false, loaded: true, error: message });
    } finally {
      loadPromise = undefined;
    }
  })();

  return loadPromise;
}

function ensureLoaded() {
  if (typeof window === "undefined") return;
  if (!state.loaded && !state.loading) void loadAll();
}

function runMutation(mutation: () => Promise<unknown>) {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      await mutation();
      await loadAll(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backend save failed.";
      console.error(error);
      setState({ error: message });
    }
  })();
}

export const store = {
  getFiles(): FileRecord[] {
    ensureLoaded();
    return state.files;
  },
  getMessages(): FileMessage[] {
    ensureLoaded();
    return state.messages;
  },
  getFileProcessingNotifications(): FileProcessingNotification[] {
    ensureLoaded();
    return state.fileProcessingNotifications;
  },
  getDivisions(): Division[] {
    ensureLoaded();
    return state.divisions;
  },
  getIndentors(): Indentor[] {
    ensureLoaded();
    return state.indentors;
  },
  getSettings(): AppSettings {
    ensureLoaded();
    const financialYear = state.settings.financialYear ?? defaultSettings.financialYear;
    return normalizeSettingsYears({ ...defaultSettings, ...state.settings, financialYear });
  },
  getUsers(): AppUser[] {
    ensureLoaded();
    return state.users;
  },
  updateSettings(patch: Partial<AppSettings>) {
    setState({ settings: { ...store.getSettings(), ...patch } });
    runMutation(() =>
      request("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  },
  addFinancialYear(label: string, select = true) {
    runMutation(() =>
      request("/api/settings/financial-years", {
        method: "POST",
        body: JSON.stringify({ label, select }),
      }),
    );
  },
  deleteFinancialYear(label: string) {
    runMutation(() =>
      request(`/api/settings/financial-years/${encodeURIComponent(label)}`, {
        method: "DELETE",
      }),
    );
  },
  getDivisionsForYear(year: string, includeInactive = false) {
    return request<{ divisions: Division[] }>(divisionsPath(year, includeInactive));
  },
  login(username: string, password: string) {
    return (async () => {
      await request<{ user: AppUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await loadAll(true);
    })();
  },
  verifyAdminPassword(password: string) {
    return request<{ ok: true }>("/api/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },
  listSuspectedAnomalyAcceptances() {
    return request<{
      acceptances: Array<{
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
        acceptedByName?: string;
        acceptedAt?: string;
        reviewedByName?: string;
        reviewedAt?: string;
        revokedByName?: string;
        revokedAt?: string;
        adminMessage?: string;
      }>;
    }>("/api/dashboard/suspected-anomalies/acceptances");
  },
  listSuspectedAnomalies(selectedYear: string) {
    const params = new URLSearchParams({ selectedYear });
    return request<{
      rows: Array<{
        signature: string;
        fileId: string;
        fileRef: string;
        division: string;
        indentor: string;
        description: string;
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
        scope?: string;
      }>;
    }>(`/api/dashboard/suspected-anomalies?${params.toString()}`);
  },
  async countSuspectedAnomalies(selectedYear: string) {
    const params = new URLSearchParams({ selectedYear });
    const payload = await request<{ rows: Array<{ signature: string }> }>(
      `/api/dashboard/suspected-anomalies?${params.toString()}`,
    );
    return payload.rows.length;
  },
  acceptSuspectedAnomaly(signature: string, reason: string) {
    return request<{ ok: true }>("/api/dashboard/suspected-anomalies/acceptances", {
      method: "POST",
      body: JSON.stringify({ signature, reason }),
    });
  },
  reviewSuspectedAnomaly(signature: string, action: string, adminMessage?: string) {
    return request<{ ok: true }>("/api/dashboard/suspected-anomalies/acceptances/review", {
      method: "POST",
      body: JSON.stringify({ signature, action, adminMessage }),
    });
  },
  clearSuspectedAnomalyHistory(password: string, signatures: string[]) {
    return request<{ ok: true }>("/api/dashboard/suspected-anomalies/acceptances/clear-history", {
      method: "POST",
      body: JSON.stringify({ password, signatures }),
    });
  },
  listAnomalyRules() {
    return request<{
      rules: Array<{
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
        createdByName?: string;
        createdAt?: string;
        updatedAt?: string;
      }>;
      fields: Array<{ key: string; label: string; scope: string }>;
    }>("/api/dashboard/suspected-anomalies/rules");
  },
  createAnomalyRule(rule: {
    name?: string;
    description?: string;
    ruleType?: string;
    fieldA?: string;
    operator?: string;
    fieldB?: string;
    fixedValue?: string;
    thresholdDays?: number;
    severity?: string;
    scope?: string;
    enabled?: boolean;
  }) {
    return request<{ rule: unknown }>("/api/dashboard/suspected-anomalies/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    });
  },
  updateAnomalyRule(id: string, patch: { enabled: boolean }) {
    return request<{ ok: true }>(`/api/dashboard/suspected-anomalies/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  viewerLogin(divisionId: string, password: string) {
    return (async () => {
      await request<{ user: AppUser }>("/api/auth/viewer-login", {
        method: "POST",
        body: JSON.stringify({ divisionId, password }),
      });
      await loadAll(true);
    })();
  },
  logout() {
    return (async () => {
      await request<{ ok: true }>("/api/auth/logout", { method: "POST" });
      setState({
        files: [],
        messages: [],
        indentors: [],
        users: [],
        authUser: undefined,
        loaded: false,
      });
      await loadAll(true);
    })();
  },
  addFile(f: Omit<FileRecord, "id" | "createdAt">) {
    return (async () => {
      const result = await request<{ file: FileRecord }>("/api/files", {
        method: "POST",
        body: JSON.stringify(f),
      });
      setState({ files: upsertFile(state.files, result.file) });
      return result.file;
    })();
  },
  updateFile(id: string, patch: Partial<FileRecord>) {
    setState({ files: state.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
    return (async () => {
      const result = await request<{ file: FileRecord }>(`/api/files/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setState({ files: upsertFile(state.files, result.file) });
      return result.file;
    })();
  },
  createMessage(fileId: string, section: string, text: string) {
    return (async () => {
      const result = await request<{ message: FileMessage }>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ fileId, section, text }),
      });
      setState({ messages: upsertMessage(state.messages, result.message) });
    })();
  },
  replyToMessage(id: string, text: string) {
    return (async () => {
      const result = await request<{ message: FileMessage }>(`/api/messages/${id}/replies`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setState({ messages: upsertMessage(state.messages, result.message) });
    })();
  },
  resolveMessage(id: string) {
    return (async () => {
      const result = await request<{ message: FileMessage }>(`/api/messages/${id}/resolve`, {
        method: "POST",
      });
      setState({ messages: upsertMessage(state.messages, result.message) });
    })();
  },
  markMessageViewed(id: string) {
    return (async () => {
      const result = await request<{ message: FileMessage }>(`/api/messages/${id}/view`, {
        method: "POST",
      });
      setState({ messages: upsertMessage(state.messages, result.message) });
    })();
  },
  acknowledgeFileProcessingNotification(id: string) {
    return (async () => {
      const result = await request<{ notification: FileProcessingNotification }>(
        `/api/messages/file-processing/${id}/acknowledge`,
        {
          method: "POST",
        },
      );
      setState({
        fileProcessingNotifications: upsertFileProcessingNotification(
          state.fileProcessingNotifications,
          result.notification,
        ),
      });
    })();
  },
  deleteMessage(id: string) {
    return (async () => {
      await request<{ deleted: true }>(`/api/messages/${id}`, {
        method: "DELETE",
      });
      setState({ messages: state.messages.filter((message) => message.id !== id) });
    })();
  },
  deleteFile(id: string, deletionPassword: string) {
    setState({ files: state.files.filter((f) => f.id !== id) });
    return request(`/api/files/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ deletionPassword }),
    });
  },
  listArchivedFiles() {
    return request<{ files: FileRecord[] }>("/api/files/archive/list");
  },
  restoreArchivedFile(id: string) {
    return (async () => {
      await request<{ file: FileRecord }>(`/api/files/${id}/restore`, { method: "POST" });
      await loadAll(true);
    })();
  },
  permanentlyDeleteArchivedFile(id: string, deletionPassword: string) {
    return (async () => {
      await request<{ deleted: true; file: FileRecord }>(`/api/files/archive/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ deletionPassword }),
      });
      await loadAll(true);
    })();
  },
  addDivision(
    name: string,
    code?: string,
    allocatedCapital?: string,
    allocatedRevenue?: string,
    ad?: string,
    financialYearOverride?: string,
  ) {
    const selectedYear = store.getSettings().selectedYear;
    const financialYear =
      financialYearOverride ||
      (isAllActiveFilesYear(selectedYear) || isActivePlusCurrentFyClosedYear(selectedYear)
        ? store.getSettings().financialYear
        : selectedYear) ||
      store.getSettings().financialYear;
    runMutation(() =>
      request("/api/divisions", {
        method: "POST",
        body: JSON.stringify({ name, code, allocatedCapital, allocatedRevenue, ad, financialYear }),
      }),
    );
  },
  updateDivision(id: string, patch: Partial<Division> & { viewerPassword?: string }) {
    const financialYear = store.getSettings().selectedYear || store.getSettings().financialYear;
    setState({ divisions: state.divisions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    runMutation(() =>
      request(`/api/divisions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, financialYear }),
      }),
    );
  },
  saveDivisionAllocation(
    id: string,
    financialYear: string,
    patch: Pick<Partial<Division>, "allocatedCapital" | "allocatedRevenue" | "active">,
  ) {
    if (financialYear === store.getSettings().selectedYear) {
      setState({ divisions: state.divisions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    }
    return (async () => {
      await request(`/api/divisions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, financialYear }),
      });
      await loadAll(true);
    })();
  },
  mergeDivisions(payload: DivisionMergePayload) {
    return (async () => {
      await request<{
        merge: { id: string; movedFileCount: number; targetDivision?: Division };
      }>("/api/divisions/merge", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadAll(true);
    })();
  },
  splitTransferDivision(payload: DivisionSplitTransferPayload) {
    return (async () => {
      await request<{
        transfer: {
          movedFileCount: number;
          movedIndentorCount: number;
          sourceDivision?: Division;
          targetDivision?: Division;
        };
      }>("/api/divisions/split-transfer", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadAll(true);
    })();
  },
  deleteDivision(id: string) {
    setState({
      divisions: state.divisions.filter((d) => d.id !== id),
      indentors: state.indentors.filter((indentor) => indentor.divisionId !== id),
      users: state.users.map((user) => ({
        ...user,
        divisionIds: user.divisionIds.filter((divId) => divId !== id),
      })),
    });
    runMutation(() => request(`/api/divisions/${id}`, { method: "DELETE" }));
  },
  listArchivedDivisions() {
    const financialYear = store.getSettings().selectedYear || store.getSettings().financialYear;
    return request<{ divisions: Division[] }>(
      `/api/divisions/archive/list?year=${encodeURIComponent(financialYear)}`,
    );
  },
  restoreArchivedDivision(id: string) {
    const financialYear = store.getSettings().selectedYear || store.getSettings().financialYear;
    return (async () => {
      await request<{ division: Division }>(
        `/api/divisions/${id}/restore?year=${encodeURIComponent(financialYear)}`,
        { method: "POST" },
      );
      await loadAll(true);
    })();
  },
  permanentlyDeleteArchivedDivision(id: string, deletionPassword: string) {
    return (async () => {
      await request<{ deleted: true; division: Division }>(`/api/divisions/archive/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ deletionPassword }),
      });
      await loadAll(true);
    })();
  },
  addIndentor(
    indentor: Pick<
      Indentor,
      "divisionId" | "name" | "sfId" | "designation" | "mobileNo" | "landlineNo" | "email"
    >,
  ) {
    return request<{ indentor: Indentor }>("/api/indentors", {
      method: "POST",
      body: JSON.stringify(indentor),
    });
  },
  updateIndentor(
    id: string,
    patch: Pick<
      Indentor,
      "divisionId" | "name" | "sfId" | "designation" | "mobileNo" | "landlineNo" | "email"
    >,
  ) {
    return request<{ indentor: Indentor }>(`/api/indentors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  deleteIndentor(id: string) {
    return request<{ deleted: true; indentor: Indentor }>(`/api/indentors/${id}`, {
      method: "DELETE",
    });
  },
  addUser(user: Omit<AppUser, "id"> & { password: string }) {
    runMutation(() =>
      request("/api/users", {
        method: "POST",
        body: JSON.stringify(user),
      }),
    );
  },
  updateUser(id: string, patch: Partial<AppUser> & { password?: string }) {
    setState({ users: state.users.map((user) => (user.id === id ? { ...user, ...patch } : user)) });
    runMutation(() =>
      request(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  },
  deleteUser(id: string) {
    setState({ users: state.users.filter((user) => user.id !== id) });
    runMutation(() => request(`/api/users/${id}`, { method: "DELETE" }));
  },
  subscribe(fn: () => void) {
    ensureLoaded();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reload() {
    return loadAll(true);
  },
};

export function fetchIndentors({
  divisionId,
  q,
  page = 1,
  pageSize = 50,
}: {
  divisionId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (divisionId) params.set("divisionId", divisionId);
  if (q?.trim()) params.set("q", q.trim());
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return request<IndentorSearchResult>(`/api/indentors?${params.toString()}`);
}

export function fetchMasterFirms({
  q,
  page = 1,
  pageSize = 50,
}: {
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return request<MasterFirmSearchResult>(`/api/firms?${params.toString()}`);
}

export function createMasterFirm(payload: Partial<MasterFirm>) {
  return request<{ firm: MasterFirm }>("/api/firms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMasterFirm(id: string, payload: Partial<MasterFirm>) {
  return request<{ firm: MasterFirm }>(`/api/firms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMasterFirm(id: string) {
  return request<{ deleted: true; firm: MasterFirm }>(`/api/firms/${id}`, {
    method: "DELETE",
  });
}

export function fetchReportPreferences<T extends Record<string, unknown>>(reportKey: string) {
  return request<{ preferences: T }>(
    `/api/settings/report-preferences/${encodeURIComponent(reportKey)}`,
  );
}

export function saveReportPreferences<T extends Record<string, unknown>>(
  reportKey: string,
  preferences: T,
) {
  return request<{ preferences: T }>(
    `/api/settings/report-preferences/${encodeURIComponent(reportKey)}`,
    {
      method: "PUT",
      body: JSON.stringify(preferences),
    },
  );
}

export type MerCashOutgoRow = {
  financialYear: string;
  monthKey: string;
  capital: number;
  revenue: number;
  total: number;
  updatedAt?: string;
};

export function fetchMerCashOutgo(financialYear: string) {
  const params = new URLSearchParams({ financialYear });
  return request<{ rows: MerCashOutgoRow[] }>(`/api/reports/mer-data?${params.toString()}`);
}

export function saveMerCashOutgo(
  financialYear: string,
  rows: Array<Pick<MerCashOutgoRow, "monthKey" | "capital" | "revenue">>,
) {
  return request<{ rows: MerCashOutgoRow[] }>("/api/reports/mer-data", {
    method: "PUT",
    body: JSON.stringify({ financialYear, rows }),
  });
}

export function fetchFile(id: string) {
  return request<{ file: FileRecord }>(`/api/files/${id}`);
}

export function fetchFilesByUniqueCode(code: string) {
  return request<{ files: FileRecord[] }>(`/api/files/by-unique-code/${encodeURIComponent(code)}`);
}

export function fetchFilesForYear(year: string) {
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  return request<{ files: FileRecord[] }>(
    `/api/files${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export function fetchNextUniqueCode({
  financialYear,
  division,
  divisionId,
}: {
  financialYear: string;
  division: string;
  divisionId?: string;
}) {
  const params = new URLSearchParams();
  params.set("financialYear", financialYear);
  params.set("division", division);
  if (divisionId) params.set("divisionId", divisionId);
  return request<{ uniqueCode: string }>(`/api/files/next-unique-code?${params.toString()}`);
}

export function lookupQuickStatusFiles({
  controlNo,
  description,
}: {
  controlNo?: string;
  description?: string;
}) {
  const params = new URLSearchParams();
  if (controlNo) params.set("controlNo", controlNo);
  if (description) params.set("description", description);
  return request<{ files: QuickStatusFileSummary[] }>(
    `/api/files/quick-status/lookup?${params.toString()}`,
  );
}

export function fetchQuickStatusContext(fileId: string) {
  return request<{ file: FileRecord; statuses: FileStatusUpdate[] }>(
    `/api/files/quick-status/${fileId}`,
  );
}

export function createFileStatusUpdate(fileId: string, text: string) {
  return request<{ statuses: FileStatusUpdate[] }>(`/api/files/quick-status/${fileId}/status`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function updateFileStatusUpdate(statusId: string, text: string) {
  return request<{ statuses: FileStatusUpdate[] }>(`/api/files/quick-status/status/${statusId}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

export function useFiles() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getFiles();
}

export function useMessages() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getMessages();
}

export function useFileProcessingNotifications() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getFileProcessingNotifications();
}

export function useDivisions() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getDivisions();
}

export function useIndentors() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getIndentors();
}

export function useSettings() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getSettings();
}

export function useUsers() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getUsers();
}

export function useActiveUser() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  ensureLoaded();
  return state.authUser;
}

export function useStoreStatus() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  ensureLoaded();
  return { loading: state.loading, loaded: state.loaded, error: state.error };
}

export function useAccessibleDivisions() {
  const divisions = useDivisions();
  const activeUser = useActiveUser();
  if (
    !activeUser ||
    activeUser.role === "admin" ||
    activeUser.role === "sub_admin" ||
    activeUser.role === "universal_viewer"
  )
    return divisions;
  return divisions.filter((division) => activeUser.divisionIds.includes(division.id));
}

export function useAccessibleFiles() {
  const files = useFiles();
  const settings = useSettings();
  const accessibleDivisions = useAccessibleDivisions();
  const activeUser = useActiveUser();
  const yearFilteredFiles = settings.selectedYear
    ? files.filter((file) =>
        isFileVisibleForYear(file, settings.selectedYear, settings.financialYear),
      )
    : files;
  if (
    !activeUser ||
    activeUser.role === "admin" ||
    activeUser.role === "sub_admin" ||
    activeUser.role === "universal_viewer"
  ) {
    return yearFilteredFiles;
  }
  const allowedDivisionNames = new Set(accessibleDivisions.map((division) => division.name));
  return yearFilteredFiles.filter(
    (file) =>
      file.division &&
      allowedDivisionNames.has(file.division) &&
      userCanAccessFileCategory(activeUser, file),
  );
}

function userCanAccessFileCategory(user: AppUser, file: Pick<FileRecord, "fileType" | "mode">) {
  if (user.role !== "editor" || !Array.isArray(user.allowedFileCategories)) return true;
  const categories = expandLegacyAllowedFileCategories(user.allowedFileCategories);
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  return categories.some((category) => {
    if (category === "cars") return fileType === "cars";
    if (category === "amc") return fileType === "amc";
    if (category === "mpc") return fileType === "mpc";
    if (category === "om") return fileType === "o&m";
    return (
      fileType !== "amc" &&
      fileType !== "mpc" &&
      fileType !== "cars" &&
      fileType !== "capsi" &&
      fileType !== "o&m"
    );
  });
}

function expandLegacyAllowedFileCategories(categories: string[]) {
  const categorySet = new Set(categories);
  if (
    categorySet.has("goodsServices") &&
    categorySet.has("amc") &&
    categorySet.has("mpc") &&
    categorySet.has("cars") &&
    !categorySet.has("om")
  ) {
    categorySet.add("om");
  }
  return Array.from(categorySet);
}

export function isIncomplete(f: FileRecord) {
  return !f.title || !f.division || !f.officer || !f.imms || !f.date;
}
