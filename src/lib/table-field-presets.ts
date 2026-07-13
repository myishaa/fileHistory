export type TableFieldPreset = {
  id: string;
  name: string;
  fieldKeys: string[];
  owner?: "global" | "personal";
  ownerUserId?: string;
};

export type TableFieldPresetGroup = {
  title: string;
  fields: Array<{ key: string; label: string }>;
};

export const tableFieldPresetGroups: TableFieldPresetGroup[] = [
  {
    title: "File details",
    fields: [
      { key: "division", label: "Division" },
      { key: "imms", label: "Control number" },
      { key: "year", label: "Year" },
      { key: "uniqueCode", label: "Unique code" },
      { key: "receivedDate", label: "Received date" },
      { key: "fileNo", label: "File no" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Demand description" },
      { key: "valueCapital", label: "Value (Capital)" },
      { key: "valueRevenue", label: "Value (Revenue)" },
      { key: "fileType", label: "File Type" },
      { key: "mode", label: "Mode" },
      { key: "tcec", label: "TCEC (Yes/No)" },
      { key: "gem", label: "GeM (Yes/No)" },
      { key: "highValue", label: "High value (Yes/No)" },
      { key: "rqa", label: "R&QA (Yes/No)" },
      { key: "ifa", label: "IFA (Yes/No)" },
      { key: "bg", label: "BG (Yes/No)" },
      { key: "demandCancelled", label: "Demand cancelled (Yes/No)" },
      { key: "demandCancelledDate", label: "Demand cancelled date" },
    ],
  },
  {
    title: "Approval and bidding",
    fields: [
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date" },
      { key: "immsDate", label: "Control date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date" },
      { key: "adVettingDate", label: "AD Vetting date" },
      { key: "rqaApprovalDate", label: "R&QA approval date" },
      { key: "ifaSentDate", label: "IFA sent date" },
      { key: "ifaFinalDate", label: "IFA final date" },
      { key: "cfaSentDate", label: "CFA sent date" },
      { key: "cfaDate", label: "CFA approval date" },
      { key: "tenderLive", label: "Tender Live (Yes/No)" },
      { key: "bidNumber", label: "Bid number" },
      { key: "bidDate", label: "Bid date" },
      { key: "bidOpeningDate", label: "Bid closing date" },
      { key: "biddingStageOver", label: "Bidding stage over" },
      { key: "cncDate", label: "CNC date" },
      { key: "cncApprovalDate", label: "CNC approval date" },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "noOfSo", label: "No. of S.O." },
      { key: "soNo", label: "S.O. No." },
      { key: "gemSoNo", label: "GeM S.O. No." },
      { key: "soDate", label: "S.O. date" },
      { key: "soValueCapital", label: "S.O value(Capital)" },
      { key: "soValueRevenue", label: "S.O. value (Revenue)" },
      { key: "dpDate", label: "D.P. date" },
      { key: "firm", label: "Firm" },
      { key: "firmType", label: "Firm Type" },
      { key: "firmTypeOther", label: "Firm Type Other" },
      { key: "bgValidityDate", label: "BG validity date" },
      { key: "dpExtension", label: "DP extension (Yes/No)" },
      { key: "dpExtensionCount", label: "Extension count" },
      { key: "ld", label: "LD" },
      { key: "revisedDp", label: "Revised D.P." },
      { key: "materialReceiptDate", label: "Material receipt date" },
      { key: "irPreparationDate", label: "IR Preparation" },
      { key: "irReceiptDate", label: "IR Receipt" },
      { key: "billPreparationDate", label: "Bill preparation" },
      { key: "billSentForPaymentDate", label: "Bill sent for payment" },
      { key: "paymentDate", label: "Payment Date" },
      { key: "paymentMode", label: "Payment mode(Online/Offline)" },
      { key: "actualPaymentCapital", label: "Actual payment amount (Capital)" },
      { key: "actualPaymentRevenue", label: "Actual payment amount (Revenue)" },
      { key: "bgReturnDate", label: "BG return date" },
      { key: "soCancelled", label: "S.O. cancelled (Yes/No)" },
      { key: "soCancelledDate", label: "S.O. cancelled date" },
      { key: "stageDelivery", label: "Stage Delivery" },
      { key: "stageDeliveryCount", label: "No. of stage deliveries" },
      { key: "stagePayment", label: "Stage payment" },
      { key: "advancePayment", label: "Advance Payment" },
    ],
  },
  {
    title: "Firm details",
    fields: [
      { key: "invitedFirms", label: "Invited firms" },
      { key: "bidderFirms", label: "Bidders" },
    ],
  },
];

export const defaultTableFieldPresets: TableFieldPreset[] = [
  {
    id: "director",
    name: "Director",
    fieldKeys: [
      "division",
      "indentor",
      "demandDescription",
      "valueCapital",
      "valueRevenue",
      "fileType",
      "mode",
      "receivedDate",
      "cfaDate",
      "soDate",
      "firm",
      "soValueCapital",
      "soValueRevenue",
    ],
  },
  {
    id: "head",
    name: "Head",
    fieldKeys: [
      "division",
      "imms",
      "fileNo",
      "indentor",
      "demandDescription",
      "receivedDate",
      "scrutinyCompletionDate",
      "immsDate",
      "tenderLive",
      "bidOpeningDate",
      "soDate",
      "billSentForPaymentDate",
      "paymentDate",
    ],
  },
];
