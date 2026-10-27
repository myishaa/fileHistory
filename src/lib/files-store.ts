// Backend-backed store for files, divisions, users, and settings.
import * as React from "react";
import type { MmgSummaryFieldConfig } from "@/lib/mmg-summary";
import type { DemandProcessingPreset } from "@/lib/demand-processing-analysis";
import type { QuickEntryExcelPreset } from "@/lib/quick-entry-excel";
import { defaultTableFieldPresets, type TableFieldPreset } from "@/lib/table-field-presets";
import type { FileTypeGroup, FileTypeGroupSetting } from "@/lib/file-type-groups";
import { defaultChartColorOrder } from "@/lib/chart-colors";
import {
  defaultAddEditRibbonFields,
  type AddEditRibbonFieldKey,
} from "@/lib/add-edit-ribbon-fields";
import {
  ALL_ACTIVE_FILES_YEAR,
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isAllFilesYear,
  isFileVisibleForYear,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";
import { readFilterCombinationLock } from "@/lib/filter-combination-lock";

const anomalyRefreshStorageKey = "recordkeeper:anomaly-data-updated";

function notifyAnomalyDataUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("recordkeeper:anomaly-data-updated"));
  try {
    window.localStorage.setItem(anomalyRefreshStorageKey, `${Date.now()}-${Math.random()}`);
  } catch {
    // Same-tab listeners still receive the event when storage is unavailable.
  }
}

export type FileRecord = {
  id: string;
  title?: string;
  divisionId?: string;
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
  refloatGemUndertakingDate?: string;
  refloatRecommendationDate?: string;
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
  refloatBiddingStageOver?: string;
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
  actualJobCompletionDate?: string;
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
  noFurtherAction?: string;
  noFurtherActionDate?: string;
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
  fileNo?: string;
  soNumbers?: string;
  itemDescription?: string;
  division?: string;
  indentor?: string;
  receivedDate?: string;
};

export type FileIdentifierSuggestion = {
  id: string;
  uniqueCode?: string;
  controlNo?: string;
  fileNo?: string;
  soNumbers?: string;
  itemDescription?: string;
  division?: string;
};

export type SupplyOrderDetail = {
  id?: string;
  includeInPaymentTiming?: boolean;
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
  actualJobCompletionDate?: string;
  jobCompletionDate?: string;
  irPreparationDate?: string;
  irReceiptDate?: string;
  billPreparationDate?: string;
  billNo?: string;
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
  noFurtherAction?: string;
  noFurtherActionDate?: string;
  stageDelivery?: string;
  stageDeliveryCount?: string;
  stagePayment?: string;
  advancePayment?: string;
  advancePaymentDetail?: AdvancePaymentDetail;
  deliveryPeriodStartDate?: string;
  stageDeliveryLabel?: string;
  stageDeliveries?: StageDeliveryDetail[];
  supplementaryBills?: SupplementaryBillDetail[];
  firmRatingValues?: Record<string, string>;
};

export type SupplementaryBillDetail = {
  id?: string;
  includeInPaymentTiming?: boolean;
  billNo?: string;
  billAmountCapital?: string;
  billAmountRevenue?: string;
  billSentForPaymentDate?: string;
  billReturnCycles?: BillReturnCycle[];
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
  remarks?: string;
};

export type AdvancePaymentDetail = {
  includeInPaymentTiming?: boolean;
  currentMilestone?: string;
  completedMilestones?: string[];
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
  expectedPaymentDate?: string;
  billPreparationDate?: string;
  billNo?: string;
  billSentForPaymentDate?: string;
  billReturnCycles?: BillReturnCycle[];
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
};

export type StageDeliveryDetail = {
  includeInPaymentTiming?: boolean;
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
  currentMilestone?: string;
  completedMilestones?: string[];
  deliveryPeriodStartDate?: string;
  dpDate?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  ldType?: string;
  ldPercentage?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  actualJobCompletionDate?: string;
  jobCompletionDate?: string;
  irPreparationDate?: string;
  irReceiptDate?: string;
  billPreparationDate?: string;
  billNo?: string;
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
  archivedAt?: string;
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
  firmType?: string;
  firmTypeOther?: string;
  emailId?: string;
  city?: string;
  address?: string;
  firmUniqueNo?: string;
  contactNo?: string;
  firmRating?: string;
  createdBy?: string;
  createdByName?: string;
  archivedAt?: string;
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
export type IndentorTransferScope = "active" | "financialYear" | "all";
export type IndentorTransferPreviewFile = {
  id: string;
  uniqueCode?: string;
  imms?: string;
  fileNo?: string;
  title?: string;
  division?: string;
  year?: string;
  fileClosureDate?: string;
};
export type IndentorTransferPreview = {
  count: number;
  files: IndentorTransferPreviewFile[];
  sourceIndentor: Indentor;
  targetIndentor: Indentor;
};
export type IndentorTransferResult = {
  movedFileCount: number;
  sourceIndentor: Indentor;
  targetIndentor: Indentor;
  archivedSourceIndentor: boolean;
};
export type AppUserRole =
  | "admin"
  | "sub_admin"
  | "division_user"
  | "editor"
  | "viewer"
  | "universal_viewer";
export type UniversalViewerCashOutgoEditScope = "none" | "personal" | "global";
export type AppUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
  allowedFileCategories?: string[] | null;
  cashOutgoEditScope?: UniversalViewerCashOutgoEditScope;
  emergencyIpBypass?: boolean;
  archivedAt?: string;
};
export type IpAccessMode = "off" | "notify" | "restrict";
export type TrustedIpAddress = {
  id: string;
  ipAddress: string;
  remarks: string;
  active: boolean;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
};
export type IpLoginAttempt = {
  id: string;
  ipAddress: string;
  username: string;
  userId?: string;
  userName?: string;
  userRole?: AppUserRole;
  mode: IpAccessMode;
  result: "allowed" | "blocked" | "bypassed";
  reason: string;
  attemptedAt: string;
  archivedAt?: string;
  archivedByName?: string;
};
export type IpAccessConfig = {
  mode: IpAccessMode;
  currentIp: string;
  trustedIps: TrustedIpAddress[];
  attempts: IpLoginAttempt[];
  archivedAttempts: IpLoginAttempt[];
  pendingCount: number;
  emergencyBypassEnv: boolean;
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
export type SharedQuickAccessSettings = {
  initialized: boolean;
  favorites: string[];
  noticeBoardItems: string[];
  noticeBoardIntervalSeconds: number;
  noticeBoardSlideDurationMs: number;
  noticeBoardFadeOutDurationMs: number;
  noticeBoardFadeInDurationMs: number;
  noticeBoardVerticalScrollDurationMs: number;
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
  setupYear: string;
  financialYears: string[];
  financialYearStatuses?: FinancialYearStatus[];
  yearSelectionLocked: boolean;
  theme: AppTheme;
  themeTint: AppThemeTint;
  chartBarColor?: string;
  chartColorOrder?: string[];
  globalChartColorOrder?: string[];
  globalChartColorsEnforced?: boolean;
  deletionPassword: string;
  tcecCommittees: string[];
  firmTypes: string[];
  fileTypes: string[];
  fileTypeGroups: FileTypeGroupSetting[];
  modes: string[];
  gemBiddingModes?: string[];
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
  quickEntryExcelPresets?: QuickEntryExcelPreset[];
  quickEntryExcelPresetsLegacyImported?: boolean;
  activeUserId?: string;
  addEditRibbonFields?: AddEditRibbonFieldKey[];
  preSoDefaultSoOffsetDays?: number;
  preSoDefaultPaymentOffsetDays?: number;
  bgReturnOffsetDays?: number;
  delayStatusDefaultDays?: number;
  sharedQuickAccess: SharedQuickAccessSettings;
};

export type FinancialYearStatus = {
  label: string;
  archived: boolean;
};

function currentYear() {
  const startYear = new Date().getFullYear();
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const defaultSettings: AppSettings = {
  financialYear: currentYear(),
  selectedYear: "__active_plus_current_fy_closed__",
  setupYear: currentYear(),
  financialYears: [currentYear()],
  financialYearStatuses: [{ label: currentYear(), archived: false }],
  yearSelectionLocked: false,
  theme: "light",
  themeTint: "plain",
  chartBarColor: "#0f766e",
  chartColorOrder: defaultChartColorOrder,
  globalChartColorOrder: defaultChartColorOrder,
  globalChartColorsEnforced: false,
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
  gemBiddingModes: ["Custom", "Catalogue", "Comparison"],
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
  quickEntryExcelPresets: [],
  quickEntryExcelPresetsLegacyImported: false,
  firmRatingConfig: {
    fields: [
      { id: "delivery", label: "Delivery", weight: "1" },
      { id: "quality", label: "Quality", weight: "1" },
      { id: "afterSalesService", label: "After Sales Service", weight: "1" },
    ],
  },
  addEditRibbonFields: defaultAddEditRibbonFields,
  preSoDefaultSoOffsetDays: 30,
  preSoDefaultPaymentOffsetDays: 30,
  bgReturnOffsetDays: 60,
  delayStatusDefaultDays: 5,
  sharedQuickAccess: {
    initialized: false,
    favorites: [],
    noticeBoardItems: [],
    noticeBoardIntervalSeconds: 15,
    noticeBoardSlideDurationMs: 1200,
    noticeBoardFadeOutDurationMs: 1400,
    noticeBoardFadeInDurationMs: 900,
    noticeBoardVerticalScrollDurationMs: 2800,
  },
};

const defaultUsers: AppUser[] = [];

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

// Vite supplies `import.meta.env` in the browser.  The report-module audit
// also imports this store directly under `tsx`, where the object is absent.
// Keep the same development fallback in both runtimes.
const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const globalYearSessionPrefix = "recordkeeper:global-year-filter";

type StoreState = {
  files: FileRecord[];
  messages: FileMessage[];
  fileProcessingNotifications: FileProcessingNotification[];
  divisions: Division[];
  indentors: Indentor[];
  settings: AppSettings;
  users: AppUser[];
  authUser?: AppUser;
  authChecked: boolean;
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
  authChecked: false,
  loading: false,
  loaded: false,
};

let loadPromise: Promise<void> | undefined;
let loadAgain = false;

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  emit();
}

function globalYearSessionKey(userId?: string) {
  return `${globalYearSessionPrefix}:${userId ?? "anonymous"}`;
}

function readSessionSelectedYear(settings: AppSettings, userId?: string) {
  if (typeof window === "undefined") return settings.selectedYear;
  const saved = window.sessionStorage.getItem(globalYearSessionKey(userId));
  const normalized = normalizeFinancialYearLabel(saved ?? undefined);
  if (
    normalized &&
    (isAllFilesYear(normalized) ||
      isAllActiveFilesYear(normalized) ||
      isActivePlusCurrentFyClosedYear(normalized) ||
      settings.financialYears.includes(normalized))
  ) {
    return normalized;
  }
  return settings.selectedYear;
}

function applySessionSelectedYear(settings: AppSettings, userId?: string) {
  return normalizeSettingsYears({
    ...settings,
    selectedYear: readSessionSelectedYear(settings, userId),
  });
}

function writeSessionSelectedYear(year: string, userId?: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(globalYearSessionKey(userId), year);
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

function divisionsPath(year?: string, includeInactive = false, currentFinancialYear?: string) {
  const params = new URLSearchParams();
  const divisionYear =
    isAllFilesYear(year) || isAllActiveFilesYear(year) || isActivePlusCurrentFyClosedYear(year)
      ? (currentFinancialYear ?? state.settings.financialYear)
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
    isAllFilesYear(settings.selectedYear) ||
    isAllActiveFilesYear(settings.selectedYear) ||
    isActivePlusCurrentFyClosedYear(settings.selectedYear)
      ? settings.selectedYear
      : normalizeFinancialYearLabel(settings.selectedYear) || financialYear;
  const setupYear = normalizeFinancialYearLabel(settings.setupYear) || financialYear;
  const financialYears = Array.from(
    new Set(
      [financialYear, selectedYear, setupYear, ...(settings.financialYears ?? [])]
        .map((year) =>
          isAllFilesYear(year) ||
          isAllActiveFilesYear(year) ||
          isActivePlusCurrentFyClosedYear(year)
            ? undefined
            : normalizeFinancialYearLabel(year),
        )
        .filter((year): year is string => Boolean(year)),
    ),
  );
  const knownYears = new Set(financialYears);
  const financialYearStatuses = Array.from(
    new Map(
      (settings.financialYearStatuses ?? [])
        .filter((status) => status && knownYears.has(status.label))
        .map((status) => [status.label, { label: status.label, archived: status.archived === true }]),
    ).values(),
  );
  for (const label of financialYears) {
    if (!financialYearStatuses.some((status) => status.label === label)) {
      financialYearStatuses.push({ label, archived: false });
    }
  }
  return {
    ...settings,
    financialYear,
    selectedYear,
    setupYear,
    financialYears,
    financialYearStatuses,
  };
}

function loadAll(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (loadPromise) {
    if (force) loadAgain = true;
    return loadPromise;
  }

  loadPromise = (async () => {
    do {
      loadAgain = false;
      await loadAllOnce();
    } while (loadAgain);
  })();
  const currentLoad = loadPromise;
  return currentLoad.finally(() => {
    if (loadPromise === currentLoad) loadPromise = undefined;
  });
}

async function loadAllOnce() {
  setState({ loading: true, error: undefined });
  try {
    const auth = await request<{ user: AppUser | null }>("/api/auth/me");
    setState({ authChecked: true });
    if (!auth.user) {
      const settings = await request<{ settings: AppSettings }>("/api/settings");
      const effectiveSettings = applySessionSelectedYear(
        normalizeSettingsYears({
          ...defaultSettings,
          ...settings.settings,
          tableFieldPresets: settings.settings.tableFieldPresets?.length
            ? settings.settings.tableFieldPresets
            : defaultTableFieldPresets,
        }),
      );
      const divisions = await request<{ divisions: Division[] }>(
        "/api/divisions/viewer-login-options",
      );
      setState({
        files: [],
        messages: [],
        fileProcessingNotifications: [],
        divisions: divisions.divisions,
        indentors: [],
        users: [],
        authUser: undefined,
        settings: effectiveSettings,
        loading: false,
        loaded: true,
      });
      return;
    }

    const settings = await request<{ settings: AppSettings }>("/api/settings");
    const effectiveSettings = applySessionSelectedYear(
      normalizeSettingsYears({
        ...defaultSettings,
        ...settings.settings,
        activeUserId: auth.user.id,
        tableFieldPresets: settings.settings.tableFieldPresets?.length
          ? settings.settings.tableFieldPresets
          : defaultTableFieldPresets,
      }),
      auth.user.id,
    );
    const baseRequests = [
      request<{ divisions: Division[] }>(
        divisionsPath(effectiveSettings.selectedYear, false, effectiveSettings.financialYear),
      ),
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
      settings: effectiveSettings,
      loading: false,
      loaded: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load backend data.";
    console.error(error);
    setState({ loading: false, loaded: true, error: message });
  }
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
      await loadAll(true);
      const refreshError = state.error;
      setState({
        error: refreshError
          ? `${message} The latest data could not be reloaded: ${refreshError}`
          : message,
      });
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
  verifyDeletionPassword(deletionPassword: string) {
    return request<{ valid: boolean }>("/api/settings/verify-deletion-password", {
      method: "POST",
      body: JSON.stringify({ deletionPassword }),
    });
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
  async saveSettings(patch: Partial<AppSettings>) {
    const payload = await request<{ settings: AppSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setState({ settings: payload.settings });
    return payload.settings;
  },
  async updateGlobalChartColors(
    patch: Pick<AppSettings, "globalChartColorOrder" | "globalChartColorsEnforced">,
  ) {
    const payload = await request<{ settings: AppSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setState({ settings: payload.settings });
    return payload.settings;
  },
  async resetChartColorPreferencesForAllUsers() {
    const payload = await request<{ settings: AppSettings }>(
      "/api/settings/chart-colors/reset-all",
      {
        method: "POST",
      },
    );
    setState({ settings: payload.settings });
    return payload.settings;
  },
  updateSessionSelectedYear(year: string) {
    const filterLock = readFilterCombinationLock(state.authUser?.id);
    const pathname = typeof window === "undefined" ? "" : window.location.pathname;
    const search = typeof window === "undefined" ? "" : window.location.search;
    const params = new URLSearchParams(search);
    const fixedYearContext =
      (pathname === "/dashboard" &&
        (params.get("tab") === "snapshot" || params.get("tab") === "finance1") &&
        !normalizeFinancialYearLabel(filterLock?.globalYear ?? "")) ||
      (pathname === "/reports" &&
        params.get("mode") === "preSoExpectedCashOutgo" &&
        filterLock?.globalYear !== ALL_ACTIVE_FILES_YEAR);
    if (filterLock?.globalYear && !fixedYearContext) year = filterLock.globalYear;
    const settings = store.getSettings();
    writeSessionSelectedYear(year, state.authUser?.id);
    setState({ settings: normalizeSettingsYears({ ...settings, selectedYear: year }) });
    void loadAll(true);
  },
  addFinancialYear(label: string, select = true) {
    runMutation(() =>
      request("/api/settings/financial-years", {
        method: "POST",
        body: JSON.stringify({ label, select }),
      }),
    );
  },
  getFinancialYearUsageCount(label: string) {
    return request<{ count: number }>(
      `/api/settings/financial-years/${encodeURIComponent(label)}/usage-count`,
    );
  },
  deleteFinancialYear(label: string) {
    runMutation(() =>
      request(`/api/settings/financial-years/${encodeURIComponent(label)}`, {
        method: "DELETE",
      }),
    );
  },
  archiveFinancialYear(label: string, archived: boolean) {
    return runMutation(() =>
      request(`/api/settings/financial-years/${encodeURIComponent(label)}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ archived }),
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
  getIpAccessConfig() {
    return request<{ ipAccess: IpAccessConfig }>("/api/settings/ip-access").then(
      (result) => result.ipAccess,
    );
  },
  updateIpAccessMode(mode: IpAccessMode) {
    return request<{ ipAccess: IpAccessConfig }>("/api/settings/ip-access", {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }).then((result) => result.ipAccess);
  },
  addTrustedIpAddress(ipAddress: string, remarks: string) {
    return request<{ ipAccess: IpAccessConfig }>("/api/settings/ip-access/trusted", {
      method: "POST",
      body: JSON.stringify({ ipAddress, remarks }),
    }).then((result) => result.ipAccess);
  },
  updateTrustedIpAddress(id: string, patch: { remarks?: string; active?: boolean }) {
    return request<{ ipAccess: IpAccessConfig }>(`/api/settings/ip-access/trusted/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((result) => result.ipAccess);
  },
  archiveIpLoginAttempt(id: string) {
    return request<{ ipAccess: IpAccessConfig }>(`/api/settings/ip-access/attempts/${id}/archive`, {
      method: "POST",
    }).then((result) => result.ipAccess);
  },
  permanentlyDeleteArchivedIpLoginAttempt(id: string, deletionPassword: string) {
    return request<{ ipAccess: IpAccessConfig }>(`/api/settings/ip-access/attempts/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ deletionPassword }),
    }).then((result) => result.ipAccess);
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
    }>(`/api/dashboard/suspected-anomalies?${params.toString()}`, { cache: "no-store" });
  },
  async countSuspectedAnomalies(query: string) {
    const payload = await request<{ rows: Array<{ signature: string }> }>(
      `/api/dashboard/suspected-anomalies?${query}`,
      { cache: "no-store" },
    );
    return payload.rows.length;
  },
  acceptSuspectedAnomaly(signature: string, reason: string) {
    return (async () => {
      const result = await request<{ ok: true }>("/api/dashboard/suspected-anomalies/acceptances", {
        method: "POST",
        body: JSON.stringify({ signature, reason }),
      });
      notifyAnomalyDataUpdated();
      return result;
    })();
  },
  reviewSuspectedAnomaly(signature: string, action: string, adminMessage?: string) {
    return (async () => {
      const result = await request<{ ok: true }>(
        "/api/dashboard/suspected-anomalies/acceptances/review",
        {
          method: "POST",
          body: JSON.stringify({ signature, action, adminMessage }),
        },
      );
      notifyAnomalyDataUpdated();
      return result;
    })();
  },
  clearSuspectedAnomalyHistory(password: string, signatures: string[]) {
    return (async () => {
      const result = await request<{ ok: true }>(
        "/api/dashboard/suspected-anomalies/acceptances/clear-history",
        {
          method: "POST",
          body: JSON.stringify({ password, signatures }),
        },
      );
      notifyAnomalyDataUpdated();
      return result;
    })();
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
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("recordkeeper:files-updated"));
        notifyAnomalyDataUpdated();
      }
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
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("recordkeeper:files-updated"));
        notifyAnomalyDataUpdated();
      }
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
    return (async () => {
      const result = await request(`/api/files/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ deletionPassword }),
      });
      notifyAnomalyDataUpdated();
      return result;
    })();
  },
  listArchivedFiles() {
    return request<{ files: FileRecord[] }>("/api/files/archive/list");
  },
  restoreArchivedFile(id: string) {
    return (async () => {
      await request<{ file: FileRecord }>(`/api/files/${id}/restore`, { method: "POST" });
      await loadAll(true);
      notifyAnomalyDataUpdated();
    })();
  },
  permanentlyDeleteArchivedFile(id: string, deletionPassword: string) {
    return (async () => {
      await request<{ deleted: true; file: FileRecord }>(`/api/files/archive/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ deletionPassword }),
      });
      await loadAll(true);
      notifyAnomalyDataUpdated();
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
    const settings = store.getSettings();
    const financialYear = financialYearOverride || settings.setupYear || settings.financialYear;
    runMutation(() =>
      request("/api/divisions", {
        method: "POST",
        body: JSON.stringify({ name, code, allocatedCapital, allocatedRevenue, ad, financialYear }),
      }),
    );
  },
  updateDivision(id: string, patch: Partial<Division> & { viewerPassword?: string }) {
    const settings = store.getSettings();
    const financialYear = settings.setupYear || settings.financialYear;
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
    if (financialYear === store.getSettings().setupYear) {
      setState({ divisions: state.divisions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    }
    return (async () => {
      const response = await request<{ division: Division }>(`/api/divisions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, financialYear }),
      });
      await loadAll(true);
      return response.division;
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
    const settings = store.getSettings();
    const financialYear = settings.setupYear || settings.financialYear;
    return request<{ divisions: Division[] }>(
      `/api/divisions/archive/list?year=${encodeURIComponent(financialYear)}`,
    );
  },
  restoreArchivedDivision(id: string) {
    const settings = store.getSettings();
    const financialYear = settings.setupYear || settings.financialYear;
    return (async () => {
      await request<{ division: Division }>(
        `/api/divisions/archive/${id}/restore?year=${encodeURIComponent(financialYear)}`,
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
    return request<{ archived: true; indentor: Indentor }>(`/api/indentors/${id}`, {
      method: "DELETE",
    });
  },
  previewIndentorTransfer(payload: {
    sourceIndentorId: string;
    targetIndentorId: string;
    scope: IndentorTransferScope;
    financialYear?: string;
  }) {
    return request<{ preview: IndentorTransferPreview }>("/api/indentors/transfer/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  commitIndentorTransfer(payload: {
    sourceIndentorId: string;
    targetIndentorId: string;
    scope: IndentorTransferScope;
    financialYear?: string;
    reason: string;
    expectedCount: number;
    confirmationText: string;
    archiveSourceIndentor: boolean;
  }) {
    return request<{ transfer: IndentorTransferResult }>("/api/indentors/transfer", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listArchivedIndentors() {
    return request<{ indentors: Indentor[] }>("/api/indentors/archive/list");
  },
  restoreArchivedIndentor(id: string) {
    return request<{ indentor: Indentor }>(`/api/indentors/archive/${id}/restore`, {
      method: "POST",
    });
  },
  permanentlyDeleteArchivedIndentor(id: string, deletionPassword: string) {
    return request<{ deleted: true; indentor: Indentor }>(`/api/indentors/archive/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ deletionPassword }),
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
  listArchivedUsers() {
    return request<{ users: AppUser[] }>("/api/users/archive/list");
  },
  restoreArchivedUser(id: string) {
    return request<{ user: AppUser }>(`/api/users/archive/${id}/restore`, {
      method: "POST",
    });
  },
  permanentlyDeleteArchivedUser(id: string, deletionPassword: string) {
    return request<{ deleted: true; user: AppUser }>(`/api/users/archive/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ deletionPassword }),
    });
  },
  subscribe(fn: () => void) {
    ensureLoaded();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reload() {
    return loadAll(true);
  },
  clearError() {
    setState({ error: undefined });
  },
};

export function fetchIndentors({
  divisionId,
  q,
  prefix,
  page = 1,
  pageSize = 50,
}: {
  divisionId?: string;
  q?: string;
  prefix?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (divisionId) params.set("divisionId", divisionId);
  if (q?.trim()) params.set("q", q.trim());
  if (prefix) params.set("prefix", "true");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return request<IndentorSearchResult>(`/api/indentors?${params.toString()}`);
}

export async function fetchAllIndentors({
  divisionId,
  q,
  prefix,
}: {
  divisionId?: string;
  q?: string;
  prefix?: boolean;
} = {}) {
  const pageSize = 200;
  const firstPage = await fetchIndentors({ divisionId, q, prefix, page: 1, pageSize });
  const pageCount = Math.ceil(firstPage.total / pageSize);
  if (pageCount <= 1) return firstPage.indentors;
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      fetchIndentors({ divisionId, q, prefix, page: index + 2, pageSize }),
    ),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.indentors);
}

export function fetchMasterFirms({
  q,
  prefix,
  page = 1,
  pageSize = 50,
}: {
  q?: string;
  prefix?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  if (prefix) params.set("prefix", "true");
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
  return request<{ archived: true; firm: MasterFirm }>(`/api/firms/${id}`, {
    method: "DELETE",
  });
}

export function listArchivedMasterFirms() {
  return request<{ firms: MasterFirm[] }>("/api/firms/archive/list");
}

export function restoreArchivedMasterFirm(id: string) {
  return request<{ firm: MasterFirm }>(`/api/firms/archive/${id}/restore`, {
    method: "POST",
  });
}

export function permanentlyDeleteArchivedMasterFirm(id: string, deletionPassword: string) {
  return request<{ deleted: true; firm: MasterFirm }>(`/api/firms/archive/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ deletionPassword }),
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

export type PreSoCashOutgoStageOffsetPayload = {
  soOffsetDays: number;
  paymentOffsetDays: number;
};

export type PreSoCashOutgoFilePlanPayload = {
  included: boolean;
  tentativeSoDate: string;
  tentativePaymentDate: string;
};

export type PreSoCashOutgoPlanPayload = {
  defaultSoOffsetDays: number;
  defaultPaymentOffsetDays: number;
  canSave: boolean;
  canSaveStageOffsets?: boolean;
  stageOffsets: Record<string, PreSoCashOutgoStageOffsetPayload>;
  filePlans: Record<string, PreSoCashOutgoFilePlanPayload>;
};

export function fetchPreSoCashOutgoPlan() {
  return request<{ plan: PreSoCashOutgoPlanPayload }>("/api/reports/pre-so-cash-outgo-plan");
}

export function savePreSoCashOutgoPlan(payload: {
  stageOffsets: Array<{
    stageKey: string;
    soOffsetDays: number;
    paymentOffsetDays: number;
  }>;
  filePlans: Array<{
    fileId: string;
    included: boolean;
    tentativeSoDate: string;
    tentativePaymentDate: string;
  }>;
}) {
  return request<{ plan: Partial<PreSoCashOutgoPlanPayload> }>(
    "/api/reports/pre-so-cash-outgo-plan",
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function fetchFile(id: string) {
  return request<{ file: FileRecord }>(`/api/files/${id}`);
}

export function fetchFilesByUniqueCode(code: string) {
  return request<{ files: FileRecord[] }>(`/api/files/by-unique-code/${encodeURIComponent(code)}`);
}

export function fetchFilesByIdentifier(code: string) {
  return request<{ files: FileRecord[] }>(`/api/files/by-identifier/${encodeURIComponent(code)}`);
}

export function fetchFileIdentifierSuggestions(query: string, includeDemandDescription = false) {
  const params = new URLSearchParams({ q: query });
  if (includeDemandDescription) params.set("includeDemandDescription", "true");
  return request<{ files: FileIdentifierSuggestion[] }>(
    `/api/files/identifier-suggestions?${params.toString()}`,
  );
}

export function fetchFilesForYear(year: string, includeArchivedYears = false) {
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  if (includeArchivedYears) params.set("includeArchivedYears", "true");
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
  return {
    loading: state.loading,
    loaded: state.loaded,
    authChecked: state.authChecked,
    error: state.error,
  };
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

function userCanAccessFileCategory(user: AppUser, file: Pick<FileRecord, "fileType">) {
  if (user.role !== "editor" || !Array.isArray(user.allowedFileCategories)) return true;
  const categories = expandLegacyAllowedFileCategories(user.allowedFileCategories);
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  return categories.some((category) => {
    if (category.startsWith("fileType:")) {
      try {
        return (
          decodeURIComponent(category.slice("fileType:".length)).trim().toLowerCase() === fileType
        );
      } catch {
        return category.slice("fileType:".length).trim().toLowerCase() === fileType;
      }
    }
    if (category === "cars") return fileType === "cars";
    if (category === "amc") return fileType === "amc";
    if (category === "mpc") return fileType === "mpc";
    if (category === "om") return fileType === "o&m";
    return fileType === "goods & services" || fileType === "";
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
