export const delayMilestoneOptions = [
  { key: "workflowNotStarted", label: "Workflow Not Started" },
  { key: "bidding", label: "Bidding" },
  { key: "nonTcecTechnicalEvaluation", label: "Non-TCEC Technical Evaluation" },
  { key: "scrutiny", label: "Scrutiny" },
  { key: "highValue", label: "High Value" },
  { key: "tcec", label: "Pre-TCEC" },
  { key: "ad", label: "AD" },
  { key: "rqa", label: "R&QA" },
  { key: "control", label: "Controlling" },
  { key: "ifa", label: "IFA" },
  { key: "cfa", label: "CFA" },
  { key: "gemUndertaking", label: "GeM Undertaking" },
  { key: "postTcec", label: "Post-TCEC" },
  { key: "refloatBidding", label: "Refloat bidding" },
  { key: "refloatPostTcec", label: "Refloat Post-TCEC" },
  { key: "cnc", label: "CNC" },
  { key: "financialSanction", label: "Financial Sanction (TCEC cases)" },
  { key: "supplyOrder", label: "Supply Order" },
  { key: "advancePayment", label: "Advance Payment" },
  { key: "psb", label: "PSB" },
  { key: "pwb", label: "PWB" },
  { key: "psbPwb", label: "PSB+PWB" },
  { key: "delivery", label: "Delivery" },
  { key: "jobCompletion", label: "Job Completion" },
  { key: "irPreparation", label: "IR Preparation" },
  { key: "irReceipt", label: "IR Receipt" },
  { key: "billPreparation", label: "Bill preparation" },
  { key: "billSentForPayment", label: "Bill sent for payment" },
  { key: "payment", label: "Payment" },
  { key: "paymentPreSubmission", label: "Payment cycle (ASL, bill trigger to bill submission)" },
  { key: "paymentPostSubmission", label: "Payment cycle (PCDA, bill submission to payment)" },
  { key: "paymentCumulative", label: "Payment cycle (ASL+PCDA, bill trigger to payment)" },
  { key: "billReturnedForCorrection", label: "Returned Bills" },
  {
    key: "supplementaryBillReturnedForCorrection",
    label: "Supplementary bill returned for correction",
  },
] as const;

export function getDelayMilestoneKey(value: unknown) {
  return typeof value === "string" && delayMilestoneOptions.some((item) => item.key === value)
    ? value
    : "all";
}
