export type QuickEntryExcelPreset = {
  id: string;
  name: string;
  fields: string[];
  fileTypes?: string[];
  scopeMode?: "fy" | "so";
  financialYear?: string;
};

export type QuickEntryExcelFieldGroup = {
  label: string;
  fields: Array<[string, string]>;
};

export const quickEntryExcelFieldGroups: QuickEntryExcelFieldGroup[] = [
  {
    label: "File and demand details",
    fields: [
      ["uniqueCode", "Unique Code"],
      ["controlNo", "Control No."],
      ["fileNo", "File No."],
      ["year", "Financial Year"],
      ["fileDate", "File Date"],
      ["receivedDate", "Demand Received Date"],
      ["division", "Division"],
      ["indentor", "Indentor"],
      ["demandDescription", "Demand Description"],
      ["valueCapital", "Demand Capital Value"],
      ["valueRevenue", "Demand Revenue Value"],
      ["fileType", "File Type"],
      ["fileTypeGroup", "File Type Group"],
      ["mode", "Mode"],
      ["tcec", "TCEC"],
      ["gem", "GeM"],
      ["ir", "IR"],
      ["gte", "GTE"],
      ["officer", "Officer"],
      ["currency", "Currency"],
      ["exchangeRate", "Exchange Rate"],
      ["noOfSo", "Number of S.O.s"],
      ["currentMilestone", "Current Milestone"],
      ["completedMilestones", "Completed Milestones"],
      ["activeYears", "Active Financial Years"],
      ["fileRemarks", "File Remarks"],
      ["fileMarkers", "File Markers"],
      ["fileClosed", "File Closed (Yes/No)"],
      ["fileClosureDate", "File Closure Date"],
      ["demandCancelled", "Demand Cancelled (Yes/No)"],
      ["demandCancelledDate", "Demand Cancelled Date"],
    ],
  },
  {
    label: "Workflow and bidding",
    fields: [
      ["scrutinyDate", "Scrutiny Date"],
      ["scrutinyResponseDate", "Scrutiny Response Date"],
      ["scrutinyCompletionDate", "Scrutiny Completion Date"],
      ["immsDate", "Control Date"],
      ["highValue", "High Value"],
      ["highValueMeetingDate", "High Value Meeting Date"],
      ["highValueMinutesDate", "High Value Minutes Date"],
      ["ad", "AD Applicable"],
      ["adSentDate", "AD Sent Date"],
      ["adVettingDate", "AD Vetting Date"],
      ["preTcecDate", "Pre-TCEC Date"],
      ["preTcecMinutesDate", "Pre-TCEC Minutes Date"],
      ["preTcecCommitteeNo", "Pre-TCEC Committee No."],
      ["rqa", "R&QA Applicable"],
      ["rqaSentDate", "R&QA Sent Date"],
      ["rqaApprovalDate", "R&QA Approval Date"],
      ["ifa", "IFA Applicable"],
      ["ifaSentDate", "IFA Sent Date"],
      ["ifaFinalDate", "IFA Final Date"],
      ["cfaSentDate", "CFA Sent Date"],
      ["cfaDate", "CFA Approval Date"],
      ["cncDate", "CNC Date"],
      ["cncApprovalDate", "CNC Approval Date"],
      ["gemUndertakingDate", "GeM Undertaking Date"],
      ["gemBiddingMode", "GeM Bidding Mode"],
      ["psb", "PSB Applicable"],
      ["bg", "BG Applicable"],
      ["rfpVetting", "RFP Vetting"],
      ["rfpVettingInitiationDate", "RFP Vetting Initiation Date"],
      ["rfpVettingApprovalDate", "RFP Vetting Approval Date"],
      ["preBidMeeting", "Pre-Bid Meeting"],
      ["preBidMeetingDate", "Pre-Bid Meeting Date"],
      ["tenderLive", "Tender Live"],
      ["bidNumber", "Bid Number"],
      ["bidDate", "Bid Date"],
      ["bidOpeningDate", "Bid Opening Date"],
      ["bidOpened", "Bid Opened"],
      ["postTcecDate", "Post-TCEC Date"],
      ["postTcecMinutesDate", "Post-TCEC Minutes Date"],
      ["postTcecCommitteeNumber", "Post-TCEC Committee No."],
      ["refloat", "Refloat"],
      ["refloatPreBidMeeting", "Refloat Pre-Bid Meeting"],
      ["refloatPreBidMeetingDate", "Refloat Pre-Bid Meeting Date"],
      ["refloatBiddingDate", "Refloat Bidding Date"],
      ["refloatBidOpeningDate", "Refloat Bid Opening Date"],
      ["refloatPostTcecDate", "Refloat Post-TCEC Date"],
      ["refloatPostTcecMinutesDate", "Refloat Post-TCEC Minutes Date"],
      ["refloatPostTcecCommitteeNo", "Refloat Post-TCEC Committee No."],
      ["rst", "RST"],
      ["biddingStageOver", "Bidding Stage Over"],
    ],
  },
  {
    label: "S.O. and supplier",
    fields: [
      ["soNo", "S.O. No."],
      ["gemSoNo", "GeM S.O. No."],
      ["soDate", "S.O. Date"],
      ["firm", "Firm Name"],
      ["firmType", "Firm Type"],
      ["firmTypeOther", "Firm Type (Other)"],
      ["firmUniqueNo", "Firm Unique No."],
      ["firmContactNo", "Firm Contact No."],
      ["firmCity", "Firm City"],
      ["bqBasis", "BQ Basis"],
      ["soValueCapital", "S.O. Capital Value"],
      ["soValueRevenue", "S.O. Revenue Value"],
    ],
  },
  {
    label: "Delivery and contract",
    fields: [
      ["dpDate", "Original D.P."],
      ["deliveryPeriodStartDate", "Delivery Period Start Date"],
      ["dpExtension", "D.P. Extension"],
      ["dpExtensionCount", "D.P. Extension Count"],
      ["revisedDp", "Revised D.P."],
      ["ld", "L.D."],
      ["ldType", "L.D. Type"],
      ["ldPercentage", "L.D. Percentage"],
      ["materialReceiptDate", "Material Receipt Date"],
      ["actualJobCompletionDate", "Actual Job Completion Date"],
      ["jobCompletionDate", "Job Completion Received Date"],
      ["irPreparationDate", "IR Preparation Date"],
      ["irReceiptDate", "IR Receipt Date"],
    ],
  },
  {
    label: "Bills and payments",
    fields: [
      ["billPreparationDate", "Bill Preparation Date"],
      ["billNo", "Bill Number"],
      ["billAmountCapital", "Bill Amount Capital"],
      ["billAmountRevenue", "Bill Amount Revenue"],
      ["billSentForPaymentDate", "Bill Sent for Payment Date"],
      ["paymentDate", "Payment Date"],
      ["paymentMode", "Payment Mode"],
      ["actualPaymentCapital", "Actual Payment Capital"],
      ["actualPaymentRevenue", "Actual Payment Revenue"],
      ["billReturnHistory", "Bill Return / Resubmission History"],
    ],
  },
  {
    label: "Cancellation and closure",
    fields: [
      ["soCancelled", "S.O. Cancelled (Yes/No)"],
      ["soCancelledDate", "S.O. Cancelled Date"],
      ["soDemandCancelled", "S.O. Demand Cancelled (Yes/No)"],
      ["shortclosure", "Short Closure (Yes/No)"],
      ["shortclosureDate", "Short Closure Date"],
      ["noFurtherAction", "No Further Action (Yes/No)"],
      ["noFurtherActionDate", "No Further Action Date"],
    ],
  },
  {
    label: "Bank guarantees and warranty",
    fields: [
      ["psbApplicable", "PSB Applicable"],
      ["bgCoverageType", "BG Coverage Type"],
      ["psbBgNo", "PSB BG Number"],
      ["psbBgAmount", "PSB BG Amount"],
      ["psbBgReceivedDate", "PSB BG Received Date"],
      ["psbBgValidityDate", "PSB BG Validity Date"],
      ["psbBgReturnDate", "PSB BG Return Date"],
      ["pwbBgNo", "PWB BG Number"],
      ["pwbBgAmount", "PWB BG Amount"],
      ["pwbBgReceivedDate", "PWB BG Received Date"],
      ["pwbBgValidityDate", "PWB BG Validity Date"],
      ["pwbBgReturnDate", "PWB BG Return Date"],
      ["combinedBgNo", "Combined BG Number"],
      ["combinedBgAmount", "Combined BG Amount"],
      ["combinedBgReceivedDate", "Combined BG Received Date"],
      ["combinedBgValidityDate", "Combined BG Validity Date"],
      ["combinedBgReturnDate", "Combined BG Return Date"],
      ["warrantyPeriodDate", "Warranty Period Date"],
    ],
  },
  {
    label: "Stages",
    fields: [
      ["stageDelivery", "Stage Delivery"],
      ["stageDeliveryCount", "Stage Count"],
      ["stagePayment", "Stage Payment"],
      ["soCurrentMilestone", "S.O. Current Milestone"],
      ["stageDeliveryLabel", "Stage Label"],
      ["stageCurrentMilestone", "Stage Current Milestone"],
      ["stageCompletedMilestones", "Stage Completed Milestones"],
      ["stageAmountCapital", "Stage Amount Capital"],
      ["stageAmountRevenue", "Stage Amount Revenue"],
      ["stageDpDate", "Stage Original D.P."],
      ["stageRevisedDp", "Stage Revised D.P."],
      ["stageDeliveryPeriodStartDate", "Stage Delivery Period Start Date"],
      ["stageDpExtension", "Stage D.P. Extension"],
      ["stageDpExtensionCount", "Stage D.P. Extension Count"],
      ["stageLd", "Stage L.D."],
      ["stageLdType", "Stage L.D. Type"],
      ["stageLdPercentage", "Stage L.D. Percentage"],
      ["stageMaterialReceiptDate", "Stage Material Receipt Date"],
      ["stageActualJobCompletionDate", "Stage Actual Job Completion Date"],
      ["stageJobCompletionDate", "Stage Job Completion Received Date"],
      ["stageIrPreparationDate", "Stage IR Preparation Date"],
      ["stageIrReceiptDate", "Stage IR Receipt Date"],
      ["stageBillPreparationDate", "Stage Bill Preparation Date"],
      ["stageBillNo", "Stage Bill Number"],
      ["stageBillSentForPaymentDate", "Stage Bill Sent Date"],
      ["stagePaymentDate", "Stage Payment Date"],
      ["stagePaymentMode", "Stage Payment Mode"],
      ["stageActualPaymentCapital", "Stage Actual Payment Capital"],
      ["stageActualPaymentRevenue", "Stage Actual Payment Revenue"],
      ["stageBillReturnHistory", "Stage Bill Return / Resubmission History"],
    ],
  },
  {
    label: "Advance and supplementary bills",
    fields: [
      ["advancePayment", "Advance Payment"],
      ["advanceCurrentMilestone", "Advance Current Milestone"],
      ["advanceCompletedMilestones", "Advance Completed Milestones"],
      ["advanceAllocationCapital", "Advance Allocation Capital"],
      ["advanceAllocationRevenue", "Advance Allocation Revenue"],
      ["advanceExpectedPaymentDate", "Advance Expected Payment Date"],
      ["advanceBillPreparationDate", "Advance Bill Preparation Date"],
      ["advanceBillNo", "Advance Bill Number"],
      ["advanceBillSentForPaymentDate", "Advance Bill Sent Date"],
      ["advancePaymentDate", "Advance Payment Date"],
      ["advancePaymentMode", "Advance Payment Mode"],
      ["advanceActualPaymentCapital", "Advance Actual Payment Capital"],
      ["advanceActualPaymentRevenue", "Advance Actual Payment Revenue"],
      ["advanceReturnHistory", "Advance Return / Resubmission History"],
      ["supplementaryBillNo", "Supplementary Bill Number"],
      ["supplementaryBillAmountCapital", "Supplementary Bill Amount Capital"],
      ["supplementaryBillAmountRevenue", "Supplementary Bill Amount Revenue"],
      ["supplementaryBillSentForPaymentDate", "Supplementary Bill Sent Date"],
      ["supplementaryBillPaymentDate", "Supplementary Bill Payment Date"],
      ["supplementaryBillPaymentMode", "Supplementary Bill Payment Mode"],
      ["supplementaryBillActualPaymentCapital", "Supplementary Actual Payment Capital"],
      ["supplementaryBillActualPaymentRevenue", "Supplementary Actual Payment Revenue"],
      ["supplementaryBillReturnHistory", "Supplementary Return / Resubmission History"],
      ["supplementaryBillRemarks", "Supplementary Bill Remarks"],
    ],
  },
];

export const quickEntryExcelFieldLabels = new Map<string, string>(
  quickEntryExcelFieldGroups.flatMap((group) => group.fields),
);

const presetsUpdatedEvent = "quick-entry-excel-presets-updated";

function storageKey(userId: string) {
  return `recordkeeper.quickEntryExcel.user.${userId}.presets.v1`;
}

export function readQuickEntryExcelPresets(userId: string): QuickEntryExcelPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is QuickEntryExcelPreset =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        Array.isArray(item.fields),
    );
  } catch {
    return [];
  }
}

export function saveQuickEntryExcelPresets(userId: string, presets: QuickEntryExcelPreset[]) {
  window.localStorage.setItem(storageKey(userId), JSON.stringify(presets));
  window.dispatchEvent(new Event(presetsUpdatedEvent));
}

export function subscribeQuickEntryExcelPresets(onUpdate: () => void) {
  window.addEventListener(presetsUpdatedEvent, onUpdate);
  window.addEventListener("storage", onUpdate);
  return () => {
    window.removeEventListener(presetsUpdatedEvent, onUpdate);
    window.removeEventListener("storage", onUpdate);
  };
}
