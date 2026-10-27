export type AppUserRole =
  | "admin"
  | "sub_admin"
  | "division_user"
  | "editor"
  | "viewer"
  | "universal_viewer";
export type UniversalViewerCashOutgoEditScope = "none" | "personal" | "global";
export type AppTheme = "light" | "dark";
export type AppThemeTint = "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
export type FileTypeGroup = "goodsServices" | "contract";

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

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
  allowedFileCategories?: string[] | null;
  cashOutgoEditScope?: UniversalViewerCashOutgoEditScope;
  emergencyIpBypass?: boolean;
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
  tableFieldPresets: unknown[];
  liveStatusLockedFields?: string[];
  mmgLiveEnabled?: boolean;
  mmgLiveOptions?: string[];
  mmgSummaryFields?: unknown[];
  demandProcessingPresets?: unknown[];
  demandProcessingDayRanges?: unknown[];
  bgReceiptDelayDays?: number[];
  specialFileMarkers?: SpecialFileMarker[];
  firmUniqueNoLabel?: string;
  firmRatingConfig?: FirmRatingConfig;
  quickEntryExcelPresets?: QuickEntryExcelPreset[];
  quickEntryExcelPresetsLegacyImported?: boolean;
  activeUserId?: string;
  addEditRibbonFields?: string[];
  preSoDefaultSoOffsetDays?: number;
  preSoDefaultPaymentOffsetDays?: number;
  bgReturnOffsetDays?: number;
  delayStatusDefaultDays?: number;
  sharedQuickAccess?: SharedQuickAccessSettings;
};

export type FinancialYearStatus = {
  label: string;
  archived: boolean;
};

export type QuickEntryExcelPreset = {
  id: string;
  name: string;
  note?: string;
  fields: string[];
  fileTypes?: string[];
  scopeMode?: "fy" | "so";
  financialYear?: string;
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

export type FirmRatingField = {
  id: string;
  label: string;
  weight?: string;
};

export type FileTypeGroupSetting = {
  fileType: string;
  group: FileTypeGroup;
};

export type FirmRatingConfig = {
  fields: FirmRatingField[];
};

export type SpecialFileMarker = {
  code: string;
  description: string;
};

export type ValueThresholdAppliesTo = "capital" | "revenue" | "both";

export type ValueThresholdLevel = {
  id?: string;
  label: string;
  levelNumber: number;
  minValue?: string;
  maxValue?: string;
  appliesTo: ValueThresholdAppliesTo;
};

export type FileRemark = {
  id?: string;
  section?: string;
  text?: string;
  createdAt?: string;
};

export type FileMarker = {
  id?: string;
  text?: string;
  createdAt?: string;
};

export type BillReturnCycle = {
  returnedDate?: string;
  reason?: string;
  resubmittedDate?: string;
  remarks?: string;
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

export type FileRecord = {
  id: string;
  title?: string;
  divisionId?: string;
  division?: string;
  officer?: string;
  imms?: string;
  date?: string;
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
  firmUniqueNo?: string;
  firmContactNo?: string;
  firmCity?: string;
  firmType?: string;
  firmTypeOther?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
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
