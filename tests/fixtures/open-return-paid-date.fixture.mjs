export const openReturnPaidDateFile = {
  id: "qa-open-return-paid-date-20261020",
  uniqueCode: "QA-OPEN-RETURN-PAID-DATE-20261020",
  createdAt: "2026-06-01T00:00:00.000Z",
  receivedDate: "2026-06-01",
  fileType: "Goods & Services",
  fileTypeGroup: "goodsServices",
  ir: "Yes",
  demandCancelled: "No",
  completedMilestones: [],
  supplyOrders: [
    {
      soNo: "QA-OPEN-RETURN-PAID-DATE-SO",
      soDate: "2026-06-10",
      soCancelled: "No",
      noFurtherAction: "No",
      currentMilestone: "Payment",
      billPreparationDate: "2026-08-20",
      billSentForPaymentDate: "2026-08-25",
      paymentDate: "2026-09-15",
      paymentMode: "NEFT",
      billAmountCapital: "1000",
      actualPaymentCapital: "1000",
      billReturnCycles: [
        {
          returnedDate: "2026-09-01",
          reason: "QA scenario: return remains open despite recorded payment",
          resubmittedDate: "",
        },
      ],
    },
  ],
};
