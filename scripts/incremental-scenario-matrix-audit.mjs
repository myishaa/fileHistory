const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const runId = process.env.AUDIT_RUN_ID ?? String(Date.now());
const selectedYear = process.env.AUDIT_SELECTED_YEAR ?? "2026-27";
const cleanupPrefix = process.env.AUDIT_CLEANUP_PREFIX ?? `QA-MATRIX-${runId}`;
const deletionPassword = process.env.AUDIT_DELETION_PASSWORD ?? "";

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`login failed ${response.status}: ${body?.error ?? "unknown error"}`);
  }
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("login did not return recordkeeper_session cookie");
  return decodeURIComponent(match[1]);
}

async function api(path, token, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      cookie: `recordkeeper_session=${encodeURIComponent(token)}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed ${response.status}: ${body?.error ?? "unknown error"}`,
    );
  }
  return body;
}

function n(value) {
  return Number(value ?? 0) || 0;
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function defaultOrder() {
  return {
    currentMilestone: "",
    completedMilestones: [],
    financialSanctionDate: "",
    psbApplicable: "No",
    bgCoverageType: "None",
    psbBgNo: "",
    psbBgAmount: "",
    psbBgReceivedDate: "",
    psbBgValidityDate: "",
    psbBgReturnDate: "",
    pwbBgNo: "",
    pwbBgAmount: "",
    pwbBgReceivedDate: "",
    pwbBgValidityDate: "",
    pwbBgReturnDate: "",
    combinedBgNo: "",
    combinedBgAmount: "",
    combinedBgReceivedDate: "",
    combinedBgValidityDate: "",
    combinedBgReturnDate: "",
    warrantyPeriodDate: "",
    soNo: "",
    gemSoNo: "",
    soDate: "",
    soValueCapital: "",
    soValueRevenue: "",
    billAmountCapital: "",
    billAmountRevenue: "",
    dpDate: "",
    firm: "",
    bqBasis: "",
    firmUniqueNo: "",
    firmContactNo: "",
    firmCity: "",
    firmType: "",
    firmTypeOther: "",
    dpExtension: "No",
    dpExtensionCount: "",
    ld: "No",
    ldType: "",
    ldPercentage: "",
    revisedDp: "",
    materialReceiptDate: "",
    jobCompletionDate: "",
    irPreparationDate: "",
    irReceiptDate: "",
    billPreparationDate: "",
    billNo: "",
    billSentForPaymentDate: "",
    billReturnCycles: [],
    paymentDate: "",
    paymentMode: "",
    actualPaymentCapital: "",
    actualPaymentRevenue: "",
    demandCancelled: "No",
    soCancelled: "No",
    soCancelledDate: "",
    shortclosure: "No",
    shortclosureDate: "",
    stageDelivery: "No",
    stageDeliveryCount: "",
    stagePayment: "No",
    advancePayment: "No",
    advancePaymentDetail: { billReturnCycles: [] },
    stageDeliveries: [],
    supplementaryBills: [],
    firmRatingValues: {},
  };
}

function baseFile(code, overrides = {}) {
  return {
    division: "ACC",
    title: "",
    officer: "",
    imms: "",
    date: "",
    year: selectedYear,
    activeYears: [selectedYear],
    uniqueCode: code,
    receivedDate: "2026-07-01",
    scrutinyDate: "",
    scrutinyResponseDate: "",
    scrutinyCompletionDate: "",
    immsDate: "",
    fileNo: code,
    indentor: "Incremental Auditor",
    demandDescription: `${code} scenario matrix audit`,
    valueCapital: "10000",
    valueRevenue: "",
    currency: "INR",
    exchangeRate: "1",
    gte: "No",
    tcec: "NO",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    mode: "PBM",
    gem: "No",
    gemBiddingMode: "",
    highValue: "No",
    ad: "No",
    rqa: "No",
    ifa: "No",
    psb: "",
    bg: "No",
    ir: "No",
    rfpVetting: "No",
    highValueMeetingDate: "",
    highValueMinutesDate: "",
    adSentDate: "",
    preTcecDate: "",
    preTcecMinutesDate: "",
    preTcecCommitteeNo: "",
    adVettingDate: "",
    rqaSentDate: "",
    rqaApprovalDate: "",
    ifaSentDate: "",
    ifaFinalDate: "",
    cfaSentDate: "",
    cfaDate: "",
    gemUndertakingDate: "",
    rfpVettingInitiationDate: "",
    rfpVettingApprovalDate: "",
    preBidMeeting: "No",
    preBidMeetingDate: "",
    tenderLive: "No",
    bidNumber: "",
    bidDate: "",
    bidOpeningDate: "",
    bidOpened: "NO",
    refloat: "No",
    refloatPreBidMeeting: "No",
    refloatPreBidMeetingDate: "",
    postTcecDate: "",
    postTcecMinutesDate: "",
    postTcecCommitteeNumber: "",
    refloatBiddingDate: "",
    refloatBidOpeningDate: "",
    refloatPostTcecDate: "",
    refloatPostTcecMinutesDate: "",
    refloatPostTcecCommitteeNo: "",
    rst: "No",
    biddingStageOver: "No",
    cncDate: "",
    cncApprovalDate: "",
    noOfSo: "1",
    demandCancelled: "No",
    demandCancelledDate: "",
    soCancelled: "No",
    soCancelledDate: "",
    shortclosure: "No",
    shortclosureDate: "",
    currentMilestone: "",
    completedMilestones: [],
    fileClosureDate: "",
    bqFirms: [],
    invitedFirms: [],
    bidderFirms: [],
    remarks: [],
    markers: [],
    supplyOrders: [defaultOrder()],
    ...overrides,
  };
}

function updateOrder(file, patch, index = 0) {
  const supplyOrders = [...file.supplyOrders];
  supplyOrders[index] = { ...supplyOrders[index], ...patch };
  return { ...file, supplyOrders };
}

function completeBasicTimeline(file, code) {
  return {
    ...file,
    scrutinyDate: "2026-07-02",
    scrutinyResponseDate: "2026-07-03",
    scrutinyCompletionDate: "2026-07-04",
    imms: `${code}-CTRL`,
    immsDate: "2026-07-04",
    cfaSentDate: "2026-07-05",
    cfaDate: "2026-07-06",
    tenderLive: "Yes",
    bidNumber: `${code}-BID`,
    bidDate: "2026-07-07",
    bidOpeningDate: "2026-07-08",
    bidOpened: "YES",
    biddingStageOver: "Yes",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding"],
  };
}

function placeOrder(file, code) {
  return updateOrder(file, {
    financialSanctionDate: "2026-07-09",
    soNo: `${code}-SO-1`,
    gemSoNo: `${code}-GEM-1`,
    soDate: "2026-07-10",
    soValueCapital: "10000",
    firm: `${code} Firm`,
    firmType: "MSE",
    completedMilestones: ["Financial Sanction", "Supply Order"],
  });
}

async function cleanup(token) {
  const search = await api(
    `/api/files/search?selectedYear=__all_files__&freeText=${enc(cleanupPrefix)}&page=1&pageSize=500`,
    token,
  );
  for (const file of search.files ?? []) {
    if (String(file.uniqueCode ?? "").startsWith(cleanupPrefix)) {
      try {
        await api(`/api/files/${file.id}`, token, {
          method: "DELETE",
          body: JSON.stringify({ deletionPassword }),
        });
      } catch (error) {
        console.warn(
          JSON.stringify({
            cleanup: "failed",
            id: file.id,
            uniqueCode: file.uniqueCode,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }
}

async function save(token, fileId, payload, method) {
  if (method === "POST") {
    const result = await api("/api/files", token, { method: "POST", body: JSON.stringify(payload) });
    return result.file;
  }
  const result = await api(`/api/files/${fileId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return result.file;
}

async function searchCount(token, filter, extra = "") {
  const result = await api(
    `/api/files/search?selectedYear=${enc(selectedYear)}&fileYear=${enc(selectedYear)}&dashboardFilter=${enc(filter)}${extra}&page=1&pageSize=500`,
    token,
  );
  return n(result.total);
}

async function measure(token, expectations) {
  const result = {};
  for (const expectation of expectations) {
    result[expectation.label] = await searchCount(token, expectation.filter, expectation.extra ?? "");
  }
  return result;
}

function verifyDeltas(before, after, expectations) {
  return expectations
    .map((expectation) => ({
      label: expectation.label,
      filter: expectation.filter,
      expectedDelta: expectation.delta,
      actualDelta: (after[expectation.label] ?? 0) - (before[expectation.label] ?? 0),
    }))
    .filter((item) => item.actualDelta !== item.expectedDelta);
}

const expect = {
  fileCreated: { label: "file id landing", filter: "", delta: 1 },
  scrutiny: { label: "scrutiny completed", filter: "milestoneCleared:scrutiny", delta: 1 },
  cfa: { label: "CFA completed", filter: "milestoneCleared:cfa", delta: 1 },
  bidding: { label: "bidding completed", filter: "milestoneCleared:bidding", delta: 1 },
  fs: { label: "financial sanction completed", filter: "manualMilestoneCompleted:Financial Sanction", delta: 1 },
  so: { label: "supply order placed", filter: "milestoneCleared:supplyOrder", delta: 1 },
  soMonth: { label: "S.O. month July", filter: "supplyOrderMonth:2026-07", delta: 1 },
  dpValid: { label: "D.P. valid", filter: "deliveryPeriodValid", delta: 1 },
  delivery: { label: "delivery completed", filter: "deliveryCompleted", delta: 1 },
  job: { label: "job completion done", filter: "jobCompletionCompleted", delta: 1 },
  ir: { label: "IR completed", filter: "irCompleted", delta: 1 },
  billPrep: { label: "bill prepared pending", filter: "cashOutgo:billPreparation:2026-07:10::::", delta: 1 },
  billPrepMinus: { label: "bill prepared pending", filter: "cashOutgo:billPreparation:2026-07:10::::", delta: -1 },
  billSent: { label: "bill sent pending", filter: "cashOutgo:billSent:2026-07:10::::", delta: 1 },
  billSentMinus: { label: "bill sent pending", filter: "cashOutgo:billSent:2026-07:10::::", delta: -1 },
  paymentDue: { label: "payment due", filter: "paymentDue", delta: 1 },
  paymentDueMinus: { label: "payment due", filter: "paymentDue", delta: -1 },
  payment: { label: "payment completed", filter: "milestoneCleared:payment", delta: 1 },
  psb: { label: "PSB received", filter: "manualMilestoneCompleted:psb", delta: 1 },
  pwb: { label: "PWB received", filter: "manualMilestoneCompleted:pwb", delta: 1 },
  psbPwb: { label: "PSB+PWB received", filter: "manualMilestoneCompleted:psbPwb", delta: 1 },
  psbReturned: { label: "PSB returned", filter: "bgReturned:psb", delta: 1 },
  psbPwbReturned: { label: "PSB+PWB returned", filter: "bgReturned:psbPwb", delta: 1 },
  advancePending: { label: "advance pending", filter: "advancePending", delta: 1 },
  advancePendingMinus: { label: "advance pending", filter: "advancePending", delta: -1 },
  advancePaid: { label: "advance paid", filter: "advancePaid", delta: 1 },
  billReturnAny: { label: "bill return history", filter: "billReturn:any", delta: 1 },
  billReturnPending: { label: "bill return pending", filter: "billReturn:pending", delta: 1 },
  billReturnPendingMinus: { label: "bill return pending", filter: "billReturn:pending", delta: -1 },
  billReturnResubmitted: { label: "bill return resubmitted", filter: "billReturn:resubmitted", delta: 1 },
  billReturnPaid: { label: "bill return paid", filter: "billReturn:paid", delta: 1 },
  suppSubmitted: { label: "supplementary submitted", filter: "supplementaryBill:submitted", delta: 1 },
  suppSubmittedMinus: { label: "supplementary submitted", filter: "supplementaryBill:submitted", delta: -1 },
  suppAny: { label: "supplementary return history", filter: "supplementaryBill:any", delta: 1 },
  suppReturned: { label: "supplementary returned", filter: "supplementaryBill:returned", delta: 1 },
  suppReturnedMinus: { label: "supplementary returned", filter: "supplementaryBill:returned", delta: -1 },
  suppResubmitted: { label: "supplementary resubmitted", filter: "supplementaryBill:resubmitted", delta: 1 },
  suppPaid: { label: "supplementary paid", filter: "supplementaryBill:paid", delta: 1 },
  suppReturnPaid: { label: "supplementary returned paid", filter: "supplementaryBill:returnPaid", delta: 1 },
  soCancelled: { label: "S.O. cancelled", filter: "miscSoCancelled", delta: 1 },
  shortclosed: { label: "S.O. shortclosed", filter: "miscShortclosedSo", delta: 1 },
  demandCancelled: { label: "demand cancelled", filter: "miscDemandCancelled", delta: 1 },
  preTcec: { label: "Pre-TCEC completed", filter: "preTcecCompleted", delta: 1 },
  tcecFyReviewed: { label: "TCEC FY reviewed", filter: "tcecStatusFy:pre:reviewed:2026-27:QA-COMMITTEE", delta: 1 },
  cncReviewed: { label: "CNC reviewed", filter: "cncSummary:reviewed:2026-07-16", delta: 1 },
  cncApproved: { label: "CNC approved", filter: "cncSummary:approved:2026-07-16", delta: 1 },
  refloatPreBid: { label: "refloat pre-bid completed", filter: "refloatPreBidMeeting:completed:2026-07", delta: 1 },
  refloatPostTcec: { label: "refloat post-TCEC signed", filter: "tcecStatusFy:post:signed:2026-27:QA-POST-COMMITTEE", delta: 1 },
};

function scenarioNormalIr(code) {
  return [
    { name: "create shell", method: "POST", apply: (file) => ({ ...file, ir: "Yes" }), expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [expect.scrutiny, expect.cfa, expect.bidding] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.fs, expect.so, expect.soMonth] },
    { name: "future D.P.", apply: (file) => updateOrder(file, { dpDate: "2026-12-15" }), expectations: [expect.dpValid] },
    { name: "delivery and IR", apply: (file) => updateOrder(file, { materialReceiptDate: "2026-07-20", irPreparationDate: "2026-07-21", irReceiptDate: "2026-07-22", completedMilestones: [...file.supplyOrders[0].completedMilestones, "Delivery", "IR Preparation", "IR Receipt"] }), expectations: [expect.delivery, expect.ir, expect.paymentDue] },
    { name: "bill prepared", apply: (file) => updateOrder(file, { billPreparationDate: "2026-07-23", billNo: `${code}-BILL`, billAmountCapital: "10000" }), expectations: [expect.billPrep] },
    { name: "bill sent", apply: (file) => updateOrder(file, { billSentForPaymentDate: "2026-07-24" }), expectations: [expect.billPrepMinus, expect.billSent] },
    { name: "payment done", apply: (file) => updateOrder(file, { paymentDate: "2026-07-30", paymentMode: "Online", actualPaymentCapital: "9900", completedMilestones: [...file.supplyOrders[0].completedMilestones, "Bill preparation", "Bill sent for payment", "Payment"] }), expectations: [expect.billSentMinus, expect.paymentDueMinus, expect.payment] },
  ];
}

function scenarioBg(code, coverage, expectations) {
  return [
    { name: "create BG shell", method: "POST", apply: (file) => ({ ...file, bg: "Yes", ir: "No" }), expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.so] },
    {
      name: `${coverage} received`,
      apply: (file) =>
        updateOrder(file, {
          psbApplicable: coverage.includes("PSB") ? "Yes" : "No",
          bgCoverageType: coverage,
          psbBgNo: coverage.includes("PSB") ? `${code}-PSB` : "",
          psbBgAmount: coverage.includes("PSB") ? "1000" : "",
          psbBgReceivedDate: coverage.includes("PSB") ? "2026-07-11" : "",
          psbBgValidityDate: coverage.includes("PSB") ? "2027-12-31" : "",
          pwbBgNo: coverage.includes("PWB") && coverage !== "PSB+PWB" ? `${code}-PWB` : "",
          pwbBgAmount: coverage.includes("PWB") && coverage !== "PSB+PWB" ? "1000" : "",
          pwbBgReceivedDate: coverage.includes("PWB") && coverage !== "PSB+PWB" ? "2026-07-12" : "",
          pwbBgValidityDate: coverage.includes("PWB") && coverage !== "PSB+PWB" ? "2027-12-31" : "",
          combinedBgNo: coverage === "PSB+PWB" ? `${code}-COMBINED` : "",
          combinedBgAmount: coverage === "PSB+PWB" ? "1000" : "",
          combinedBgReceivedDate: coverage === "PSB+PWB" ? "2026-07-12" : "",
          combinedBgValidityDate: coverage === "PSB+PWB" ? "2027-12-31" : "",
          completedMilestones: [...file.supplyOrders[0].completedMilestones, ...expectations.completed],
        }),
      expectations: expectations.received,
    },
    ...(coverage.includes("PSB")
      ? [
          {
            name: `${coverage} returned`,
            apply: (file) =>
              updateOrder(
                file,
                coverage === "PSB+PWB"
                  ? { combinedBgReturnDate: "2026-07-20" }
                  : { psbBgReturnDate: "2026-07-20" },
              ),
            expectations: [coverage === "PSB+PWB" ? expect.psbPwbReturned : expect.psbReturned],
          },
        ]
      : []),
  ];
}

function scenarioAdvance(code) {
  return [
    { name: "create shell", method: "POST", apply: (file) => file, expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.so] },
    { name: "advance pending", apply: (file) => updateOrder(file, { advancePayment: "Yes", advancePaymentDetail: { currentMilestone: "Advance Payment", completedMilestones: [], stageAmountCapital: "2500", billPreparationDate: "2026-07-11", billNo: `${code}-ADV`, billSentForPaymentDate: "2026-07-12", billReturnCycles: [] } }), expectations: [expect.advancePending] },
    { name: "advance paid", apply: (file) => updateOrder(file, { advancePaymentDetail: { ...file.supplyOrders[0].advancePaymentDetail, paymentDate: "2026-07-13", paymentMode: "Online", actualPaymentCapital: "2500" } }), expectations: [expect.advancePendingMinus, expect.advancePaid] },
  ];
}

function scenarioReturnedBill(code) {
  const flow = scenarioNormalIr(code).slice(0, 7);
  return [
    ...flow,
    { name: "bill returned", apply: (file) => updateOrder(file, { billReturnCycles: [{ returnedDate: "2026-07-25", reason: "Correction", remarks: "" }] }), expectations: [expect.billReturnAny, expect.billReturnPending] },
    { name: "bill resubmitted", apply: (file) => updateOrder(file, { billReturnCycles: [{ returnedDate: "2026-07-25", reason: "Correction", resubmittedDate: "2026-07-26", remarks: "" }] }), expectations: [expect.billReturnPendingMinus, expect.billReturnResubmitted] },
    { name: "returned bill paid", apply: (file) => updateOrder(file, { paymentDate: "2026-07-30", paymentMode: "Online", actualPaymentCapital: "9800" }), expectations: [expect.paymentDueMinus, expect.payment, expect.billReturnPaid] },
  ];
}

function scenarioSupplementary(code) {
  const paid = scenarioNormalIr(code);
  return [
    ...paid,
    { name: "supplementary submitted", apply: (file) => updateOrder(file, { supplementaryBills: [{ billNo: `${code}-SUPP`, billAmountCapital: "500", billAmountRevenue: "", billSentForPaymentDate: "2026-07-31", billReturnCycles: [] }] }), expectations: [expect.suppSubmitted] },
    { name: "supplementary returned", apply: (file) => updateOrder(file, { supplementaryBills: [{ ...file.supplyOrders[0].supplementaryBills[0], billReturnCycles: [{ returnedDate: "2026-08-01", reason: "Correction", remarks: "" }] }] }), expectations: [expect.suppSubmittedMinus, expect.suppAny, expect.suppReturned] },
    { name: "supplementary resubmitted", apply: (file) => updateOrder(file, { supplementaryBills: [{ ...file.supplyOrders[0].supplementaryBills[0], billReturnCycles: [{ returnedDate: "2026-08-01", reason: "Correction", resubmittedDate: "2026-08-02", remarks: "" }] }] }), expectations: [expect.suppReturnedMinus, expect.suppResubmitted] },
    { name: "supplementary paid", apply: (file) => updateOrder(file, { supplementaryBills: [{ ...file.supplyOrders[0].supplementaryBills[0], paymentDate: "2026-08-05", paymentMode: "Online", actualPaymentCapital: "450" }] }), expectations: [expect.suppPaid, expect.suppReturnPaid] },
  ];
}

function scenarioContract(code, fileType) {
  return [
    { name: "create contract shell", method: "POST", apply: (file) => ({ ...file, fileType, fileTypeGroup: "contract", ir: "No" }), expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.so] },
    { name: "D.P. and job done", apply: (file) => updateOrder(file, { dpDate: "2026-07-20", jobCompletionDate: "2026-07-21", completedMilestones: [...file.supplyOrders[0].completedMilestones, "Job Completion"] }), expectations: [expect.job] },
  ];
}

function scenarioCancellation(code) {
  return [
    { name: "create shell", method: "POST", apply: (file) => file, expectations: [] },
    { name: "cancel demand before S.O.", apply: (file) => ({ ...file, demandCancelled: "Yes", demandCancelledDate: "2026-07-16" }), expectations: [expect.demandCancelled] },
  ];
}

function scenarioSoCancellation(code) {
  return [
    { name: "create shell", method: "POST", apply: (file) => file, expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.so] },
    { name: "cancel S.O.", apply: (file) => updateOrder(file, { soCancelled: "Yes", soCancelledDate: "2026-07-15" }), expectations: [expect.soCancelled] },
  ];
}

function scenarioShortclosure(code) {
  return [
    { name: "create shell", method: "POST", apply: (file) => file, expectations: [] },
    { name: "basic timeline", apply: (file) => completeBasicTimeline(file, code), expectations: [] },
    { name: "place S.O.", apply: (file) => placeOrder(file, code), expectations: [expect.so] },
    { name: "shortclose S.O.", apply: (file) => updateOrder(file, { shortclosure: "Yes", shortclosureDate: "2026-07-18" }), expectations: [expect.shortclosed] },
  ];
}

function scenarioTcecCncRefloat(code) {
  return [
    { name: "create TCEC shell", method: "POST", apply: (file) => ({ ...file, tcec: "Yes", preBidMeeting: "Yes", refloat: "Yes", refloatPreBidMeeting: "Yes" }), expectations: [] },
    {
      name: "TCEC and refloat dates",
      apply: (file) => ({
        ...completeBasicTimeline(file, code),
        preBidMeetingDate: "2026-07-09",
        preTcecDate: "2026-07-10",
        preTcecMinutesDate: "2026-07-11",
        preTcecCommitteeNo: "QA-COMMITTEE",
        refloatPreBidMeetingDate: "2026-07-12",
        refloatBiddingDate: "2026-07-13",
        refloatBidOpeningDate: "2026-07-14",
        refloatPostTcecDate: "2026-07-15",
        refloatPostTcecMinutesDate: "2026-07-16",
        refloatPostTcecCommitteeNo: "QA-POST-COMMITTEE",
      }),
      expectations: [expect.preTcec, expect.tcecFyReviewed, expect.refloatPreBid, expect.refloatPostTcec],
    },
    { name: "CNC approved", apply: (file) => ({ ...file, cncDate: "2026-07-16", cncApprovalDate: "2026-07-17" }), expectations: [expect.cncReviewed, expect.cncApproved] },
  ];
}

const scenarios = [
  ["normal-gs-ir", scenarioNormalIr],
  ["bg-psb", (code) => scenarioBg(code, "PSB", { completed: ["PSB"], received: [expect.psb] })],
  ["bg-pwb", (code) => scenarioBg(code, "PWB", { completed: ["PWB"], received: [expect.pwb] })],
  ["bg-combined", (code) => scenarioBg(code, "PSB+PWB", { completed: ["PSB+PWB"], received: [expect.psbPwb] })],
  ["advance-payment", scenarioAdvance],
  ["returned-bill", scenarioReturnedBill],
  ["supplementary-bill", scenarioSupplementary],
  ["contract-amc", (code) => scenarioContract(code, "AMC")],
  ["contract-mpc", (code) => scenarioContract(code, "MPC")],
  ["contract-om", (code) => scenarioContract(code, "O&M")],
  ["contract-cars", (code) => scenarioContract(code, "CARS")],
  ["demand-cancellation", scenarioCancellation],
  ["so-cancellation", scenarioSoCancellation],
  ["shortclosure", scenarioShortclosure],
  ["tcec-cnc-refloat", scenarioTcecCncRefloat],
];

async function runScenario(token, name, buildSteps) {
  const code = `QA-MATRIX-${runId}-${name}`;
  let file = baseFile(code);
  let savedFile;
  const failures = [];
  const steps = buildSteps(code);
  for (const step of steps) {
    let stepFailures = [];
    let checkCount = step.expectations.length;
    try {
      file = step.apply(file);
      const expectations = step.expectations.map((item) =>
        item.label === "file id landing"
          ? { ...item, filter: savedFile ? `fileIds:${enc(savedFile.id)}` : item.filter }
          : item,
      );
      const before = await measure(token, expectations);
      savedFile = await save(token, savedFile?.id, file, step.method ?? "PATCH");
      file = { ...file, id: savedFile.id };
      const fixedExpectations = step.expectations.map((item) =>
        item.label === "file id landing" ? { ...item, filter: `fileIds:${enc(savedFile.id)}` } : item,
      );
      checkCount = fixedExpectations.length;
      const after = await measure(token, fixedExpectations);
      stepFailures = verifyDeltas(before, after, fixedExpectations);
    } catch (error) {
      stepFailures = [
        {
          label: "step execution",
          filter: step.name,
          expectedDelta: "save and check should succeed",
          actualDelta: error instanceof Error ? error.message : String(error),
        },
      ];
    }
    if (stepFailures.length) failures.push({ scenario: name, step: step.name, failures: stepFailures });
    console.log(
      JSON.stringify({
        scenario: name,
        step: step.name,
        checks: checkCount,
        failures: stepFailures,
      }),
    );
    if (stepFailures.length) break;
  }
  return { name, steps: steps.length, failures };
}

async function main() {
  const token = await login();
  const results = [];
  try {
    await cleanup(token);
    if (process.env.AUDIT_CLEANUP_ONLY === "1") {
      console.log(JSON.stringify({ runId, cleanupPrefix, cleanupOnly: true }, null, 2));
      return;
    }
    for (const [name, buildSteps] of scenarios) {
      const result = await runScenario(token, name, buildSteps);
      results.push(result);
    }
  } finally {
    if (process.env.AUDIT_KEEP_FILES !== "1") await cleanup(token);
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  const failures = results.flatMap((result) => result.failures);
  console.log(JSON.stringify({ runId, scenarios: results.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
