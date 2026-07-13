export type AppUserRole = "admin" | "sub_admin" | "division_user" | "editor" | "viewer";
export type AppTheme = "light" | "dark";
export type AppThemeTint = "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";

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

export type AppUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
  allowedFileCategories?: string[] | null;
};

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
  allowedFileCategories?: string[] | null;
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
  modes: string[];
  valueThresholdLevels: ValueThresholdLevel[];
  milestones: string[];
  tableFieldPresets: unknown[];
  liveStatusLockedFields?: string[];
  mmgLiveEnabled?: boolean;
  mmgLiveOptions?: string[];
  mmgSummaryFields?: unknown[];
  activeUserId?: string;
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

export type SupplyOrderDetail = {
  currentMilestone?: string;
  completedMilestones?: string[];
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  dpDate?: string;
  firm?: string;
  firmType?: string;
  firmTypeOther?: string;
  bgValidityDate?: string;
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
  bgReturnDate?: string;
  demandCancelled?: string;
  soCancelled?: string;
  soCancelledDate?: string;
  stageDelivery?: string;
  stageDeliveryCount?: string;
  stagePayment?: string;
  advancePayment?: string;
  advancePaymentDetail?: AdvancePaymentDetail;
  deliveryPeriodStartDate?: string;
  stageDeliveryLabel?: string;
  stageDeliveries?: StageDeliveryDetail[];
};

export type AdvancePaymentDetail = {
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
  billPreparationDate?: string;
  billSentForPaymentDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
};

export type StageDeliveryDetail = {
  stageAmountCapital?: string;
  stageAmountRevenue?: string;
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
  paymentDate?: string;
  paymentMode?: string;
  actualPaymentCapital?: string;
  actualPaymentRevenue?: string;
};

export type FirmDetail = {
  firmName?: string;
  city?: string;
  emailId?: string;
};

export type FileRecord = {
  id: string;
  title?: string;
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
  mode?: string;
  gem?: string;
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
  preTcecDate?: string;
  preTcecMinutesDate?: string;
  preTcecCommitteeNo?: string;
  adVettingDate?: string;
  rqaApprovalDate?: string;
  ifaSentDate?: string;
  ifaFinalDate?: string;
  cfaSentDate?: string;
  cfaDate?: string;
  gemUndertakingDate?: string;
  rfpVettingInitiationDate?: string;
  rfpVettingApprovalDate?: string;
  tenderLive?: string;
  bidNumber?: string;
  bidDate?: string;
  bidOpeningDate?: string;
  bidOpened?: string;
  refloat?: string;
  postTcecDate?: string;
  postTcecMinutesDate?: string;
  postTcecCommitteeNumber?: string;
  refloatBiddingDate?: string;
  refloatBidOpeningDate?: string;
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
  dpDate?: string;
  firm?: string;
  firmType?: string;
  firmTypeOther?: string;
  bgValidityDate?: string;
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
  bgReturnDate?: string;
  demandCancelled?: string;
  demandCancelledDate?: string;
  soCancelled?: string;
  soCancelledDate?: string;
  invitedFirms?: FirmDetail[];
  bidderFirms?: FirmDetail[];
  supplyOrders?: SupplyOrderDetail[];
  remarks?: FileRemark[];
  markers?: FileMarker[];
  currentMilestone?: string;
  completedMilestones?: string[];
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
