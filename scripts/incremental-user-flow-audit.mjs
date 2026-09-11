const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const code = process.env.AUDIT_CODE ?? `QA-INCREMENTAL-${Date.now()}`;
const selectedYear = process.env.AUDIT_SELECTED_YEAR ?? "2026-27";

function n(value) {
  return Number(value ?? 0) || 0;
}

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
    throw new Error(`${options.method ?? "GET"} ${path} failed ${response.status}: ${body?.error ?? "unknown error"}`);
  }
  return body;
}

async function cleanup(token) {
  const search = await api(
    `/api/files/search?selectedYear=__all_files__&freeText=${encodeURIComponent(code)}&page=1&pageSize=50`,
    token,
  );
  for (const file of search.files ?? []) {
    if (file.uniqueCode === code || String(file.demandDescription ?? "").includes(code)) {
      await api(`/api/files/${file.id}`, token, { method: "DELETE" }).catch(() => undefined);
    }
  }
}

const baseOrder = {
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

const baseFile = {
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
  demandDescription: `${code} step-by-step audit`,
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
  ir: "Yes",
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
  supplyOrders: [{ ...baseOrder }],
};

function mergeFile(file, patch) {
  return {
    ...file,
    ...patch,
    supplyOrders: patch.supplyOrders ?? file.supplyOrders,
  };
}

function updateOrder(file, patch) {
  return {
    ...file,
    supplyOrders: [{ ...file.supplyOrders[0], ...patch }],
  };
}

const checks = [
  ["Search finds audit file", "fileIds", async ({ file }) => ({ expected: 1, filter: `fileIds:${encodeURIComponent(file.id)}`, exact: true })],
  ["Scrutiny completed", "dashboard", async () => ({ expected: 1, filter: "milestoneCleared:scrutiny" })],
  ["CFA completed", "dashboard", async () => ({ expected: 1, filter: "milestoneCleared:cfa" })],
  ["Bidding completed", "dashboard", async () => ({ expected: 1, filter: "milestoneCleared:bidding" })],
  ["Financial sanction completed", "dashboard", async () => ({ expected: 1, filter: "manualMilestoneCompleted:Financial Sanction" })],
  ["Supply order placed", "dashboard", async () => ({ expected: 1, filter: "milestoneCleared:supplyOrder" })],
  ["Delivery period valid", "dashboard", async () => ({ expected: 1, filter: "deliveryPeriodValid" })],
  ["Delivery completed", "dashboard", async () => ({ expected: 1, filter: "deliveryCompleted" })],
  ["IR completed", "dashboard", async () => ({ expected: 1, filter: "irCompleted" })],
  ["Bill prepared, not submitted", "dashboard", async () => ({ expected: 1, filter: "cashOutgo:billPreparation:2026-07:10::::" })],
  ["Bill submitted, payment pending", "dashboard", async () => ({ expected: 1, filter: "cashOutgo:billSent:2026-07:10::::" })],
  ["Payment completed", "dashboard", async () => ({ expected: 1, filter: "milestoneCleared:payment" })],
];

const steps = [
  {
    name: "01 create demand shell",
    apply: (file) => file,
    method: "POST",
    activeChecks: ["Search finds audit file"],
  },
  {
    name: "02 scrutiny and control completed",
    apply: (file) =>
      mergeFile(file, {
        scrutinyDate: "2026-07-02",
        scrutinyResponseDate: "2026-07-03",
        scrutinyCompletionDate: "2026-07-04",
        imms: `${code}-CTRL`,
        immsDate: "2026-07-04",
        completedMilestones: ["Scrutiny", "Controlling"],
      }),
    activeChecks: ["Search finds audit file", "Scrutiny completed"],
  },
  {
    name: "03 CFA completed",
    apply: (file) =>
      mergeFile(file, {
        cfaSentDate: "2026-07-05",
        cfaDate: "2026-07-06",
        completedMilestones: ["Scrutiny", "Controlling", "CFA"],
      }),
    activeChecks: ["Search finds audit file", "Scrutiny completed", "CFA completed"],
  },
  {
    name: "04 bidding completed",
    apply: (file) =>
      mergeFile(file, {
        tenderLive: "Yes",
        bidNumber: `${code}-BID`,
        bidDate: "2026-07-07",
        bidOpeningDate: "2026-07-08",
        bidOpened: "YES",
        biddingStageOver: "Yes",
        completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding"],
      }),
    activeChecks: ["Search finds audit file", "Scrutiny completed", "CFA completed", "Bidding completed"],
  },
  {
    name: "05 financial sanction entered",
    apply: (file) =>
      updateOrder(file, {
        financialSanctionDate: "2026-07-09",
        completedMilestones: ["Financial Sanction"],
      }),
    activeChecks: [
      "Search finds audit file",
      "Financial sanction completed",
      "Bidding completed",
    ],
  },
  {
    name: "06 supply order placed",
    apply: (file) =>
      updateOrder(file, {
        soNo: `${code}-SO-1`,
        gemSoNo: `${code}-GEM-1`,
        soDate: "2026-07-10",
        soValueCapital: "10000",
        firm: "Incremental Firm",
        firmType: "MSE",
        completedMilestones: ["Financial Sanction", "Supply Order"],
      }),
    activeChecks: [
      "Search finds audit file",
      "Financial sanction completed",
      "Supply order placed",
    ],
  },
  {
    name: "07 delivery period entered",
    apply: (file) => updateOrder(file, { dpDate: "2026-12-15" }),
    activeChecks: ["Search finds audit file", "Supply order placed", "Delivery period valid"],
  },
  {
    name: "08 delivery and IR completed",
    apply: (file) =>
      updateOrder(file, {
        materialReceiptDate: "2026-07-20",
        irPreparationDate: "2026-07-21",
        irReceiptDate: "2026-07-22",
        completedMilestones: ["Financial Sanction", "Supply Order", "Delivery", "IR Preparation", "IR Receipt"],
      }),
    activeChecks: ["Search finds audit file", "Delivery completed", "IR completed"],
  },
  {
    name: "09 bill prepared",
    apply: (file) =>
      updateOrder(file, {
        billPreparationDate: "2026-07-23",
        billNo: `${code}-BILL-1`,
        billAmountCapital: "10000",
      }),
    activeChecks: ["Search finds audit file", "Bill prepared, not submitted"],
  },
  {
    name: "10 bill submitted",
    apply: (file) => updateOrder(file, { billSentForPaymentDate: "2026-07-24" }),
    activeChecks: ["Search finds audit file", "Bill submitted, payment pending"],
  },
  {
    name: "11 payment completed",
    apply: (file) =>
      updateOrder(file, {
        paymentDate: "2026-07-30",
        paymentMode: "Online",
        actualPaymentCapital: "9950",
        completedMilestones: [
          "Financial Sanction",
          "Supply Order",
          "Delivery",
          "IR Preparation",
          "IR Receipt",
          "Bill preparation",
          "Bill sent for payment",
          "Payment",
        ],
      }),
    activeChecks: ["Search finds audit file", "Payment completed"],
  },
];

async function searchCount(token, filter) {
  const result = await api(
    `/api/files/search?selectedYear=${encodeURIComponent(selectedYear)}&fileYear=${encodeURIComponent(selectedYear)}&dashboardFilter=${encodeURIComponent(filter)}&page=1&pageSize=500`,
    token,
  );
  return n(result.total);
}

async function reportSnapshot(token) {
  const result = await api(
    `/api/reports/summary?selectedYear=${encodeURIComponent(selectedYear)}&fileYear=${encodeURIComponent(selectedYear)}&division=all&fileCategories=goodsServices,amc,mpc,cars,om&delayDays=5&delayMilestone=all&cashOutgoMonth=2026-07`,
    token,
  );
  return result.summary;
}

function reportObservations(summary) {
  return {
    files: n(summary.reportFileCount),
    monthlyFileInflow: n((summary.monthlyFileInflow ?? []).find((row) => row.monthKey === "2026-07")?.count),
    supplyOrdersInJuly: n((summary.monthWiseSupplyOrder ?? []).find((row) => row.monthKey === "2026-07")?.count),
    completedDeliveriesInJuly: n((summary.monthWiseCompletedDeliveries ?? []).find((row) => row.monthKey === "2026-07")?.count),
    billPreparedJuly: n((summary.expectedCashOutgoBillPreparationRows ?? []).find((row) => row.monthKey === "2026-07")?.total),
    billSentJuly: n((summary.billSentForPaymentRows ?? []).find((row) => row.monthKey === "2026-07")?.total),
    paidJuly: n((summary.actualCashOutgoRows ?? []).find((row) => row.monthKey === "2026-07")?.total),
  };
}

async function runChecks(token, context, activeChecks) {
  const failures = [];
  const active = new Set(activeChecks);
  for (const [label, _kind, make] of checks) {
    if (!active.has(label)) continue;
    const { expected, filter, exact } = await make(context);
    const total = await searchCount(token, filter);
    const ok = exact ? total === expected : total >= expected;
    if (!ok) failures.push({ label, filter, expected, total });
  }
  return failures;
}

async function saveStep(token, fileId, payload, method) {
  if (method === "POST") {
    const result = await api("/api/files", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return result.file;
  }
  const result = await api(`/api/files/${fileId}`, token, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return result.file;
}

async function main() {
  const token = await login();
  await cleanup(token);
  let file = structuredClone(baseFile);
  let savedFile;
  const stepResults = [];
  try {
    for (const step of steps) {
      file = step.apply(file);
      savedFile = await saveStep(token, savedFile?.id, file, step.method ?? "PATCH");
      file = { ...file, id: savedFile.id };
      const summary = await reportSnapshot(token);
      const failures = await runChecks(token, { file: savedFile, summary }, step.activeChecks);
      stepResults.push({
        step: step.name,
        fileId: savedFile.id,
        checks: step.activeChecks.length,
        failures,
        report: reportObservations(summary),
      });
      console.log(
        JSON.stringify(
          {
            step: step.name,
            checks: step.activeChecks.length,
            failures,
            report: reportObservations(summary),
          },
          null,
          2,
        ),
      );
      if (failures.length) break;
    }
  } finally {
    if (process.env.AUDIT_KEEP_FILE !== "1") await cleanup(token);
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  const failed = stepResults.some((step) => step.failures.length);
  console.log(JSON.stringify({ code, steps: stepResults.length, failed }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
