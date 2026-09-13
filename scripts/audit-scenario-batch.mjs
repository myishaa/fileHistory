const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const batch = process.env.SCENARIO_BATCH ?? "clean-baseline";
const runId = process.env.AUDIT_RUN_ID ?? String(Date.now());
const prefix = process.env.SCENARIO_PREFIX ?? `QA-BATCH-${batch}-${runId}`;
const keepFiles = process.env.AUDIT_KEEP_FILES === "1";
const checkOnly = process.env.SCENARIO_CHECK_ONLY === "1";

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`login failed ${response.status}: ${body?.error ?? "unknown error"}`);
  const match = (response.headers.get("set-cookie") ?? "").match(/recordkeeper_session=([^;]+)/);
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

function order(patch = {}) {
  return {
    currentMilestone: "",
    completedMilestones: [],
    financialSanctionDate: "2026-05-10",
    psbApplicable: "No",
    bgCoverageType: "None",
    soNo: "",
    gemSoNo: "",
    soDate: "2026-05-15",
    soValueCapital: "100000",
    soValueRevenue: "",
    billAmountCapital: "",
    billAmountRevenue: "",
    dpDate: "2026-08-14",
    firm: "QA Scenario Firm",
    bqBasis: "",
    firmUniqueNo: "QA-FIRM-001",
    firmContactNo: "9999999999",
    firmCity: "Hyderabad",
    firmType: "MSE",
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
    ...patch,
  };
}

function file(code, patch = {}) {
  return {
    division: "ACC",
    title: "",
    officer: "",
    imms: `${code}-CTRL`,
    date: "",
    year: "2026-27",
    activeYears: ["2026-27"],
    uniqueCode: code,
    receivedDate: "2026-04-01",
    scrutinyDate: "2026-04-03",
    scrutinyResponseDate: "2026-04-05",
    scrutinyCompletionDate: "2026-04-07",
    immsDate: "2026-04-08",
    fileNo: `FILE-${code}`,
    indentor: "QA Scenario Indentor",
    demandDescription: `${code} ${batch} QA scenario`,
    valueCapital: "100000",
    valueRevenue: "",
    currency: "INR",
    exchangeRate: "1",
    gte: "No",
    tcec: "No",
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
    cfaSentDate: "2026-04-12",
    cfaDate: "2026-04-16",
    gemUndertakingDate: "",
    rfpVettingInitiationDate: "",
    rfpVettingApprovalDate: "",
    preBidMeeting: "No",
    preBidMeetingDate: "",
    tenderLive: "Yes",
    bidNumber: `${code}-BID`,
    bidDate: "2026-04-20",
    bidOpeningDate: "2026-04-25",
    bidOpened: "Yes",
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
    biddingStageOver: "Yes",
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
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding"],
    fileClosureDate: "",
    bqFirms: [],
    invitedFirms: [],
    bidderFirms: [],
    remarks: [],
    markers: [],
    supplyOrders: [order({ soNo: `${code}-SO-1` })],
    ...patch,
  };
}

function cleanBaselineFiles() {
  return [
    file(`${prefix}-GS-PAID`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-GS-PAID-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-BILL-1`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Online",
          actualPaymentCapital: "100000",
        }),
      ],
    }),
    file(`${prefix}-AMC-JOB`, {
      fileType: "AMC",
      fileTypeGroup: "contract",
      ir: "No",
      supplyOrders: [
        order({
          soNo: `${prefix}-AMC-JOB-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Job Completion",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          materialReceiptDate: "",
          irPreparationDate: "",
          irReceiptDate: "",
          jobCompletionDate: "2026-06-01",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-BILL-2`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Offline",
          actualPaymentCapital: "100000",
        }),
      ],
    }),
    file(`${prefix}-STAGE-SEQUENTIAL`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-STAGE-SO`,
          stageDelivery: "Yes",
          stageDeliveryCount: "2",
          stagePayment: "Yes",
          stageDeliveries: [
            {
              deliveryPeriodStartDate: "2026-05-15",
              dpDate: "2026-06-14",
              stageAmountCapital: "50000",
              currentMilestone: "",
              completedMilestones: ["Delivery"],
              materialReceiptDate: "2026-06-10",
              irPreparationDate: "2026-06-11",
              irReceiptDate: "2026-06-12",
              billPreparationDate: "2026-06-13",
              billNo: `${prefix}-STAGE-BILL-1`,
              billSentForPaymentDate: "2026-06-14",
              paymentDate: "2026-06-20",
              paymentMode: "Online",
              actualPaymentCapital: "50000",
            },
            {
              deliveryPeriodStartDate: "2026-06-15",
              dpDate: "2026-07-14",
              stageAmountCapital: "50000",
              currentMilestone: "Delivery",
              completedMilestones: [],
            },
          ],
        }),
      ],
    }),
  ];
}

function paymentEdgeFiles() {
  return [
    file(`${prefix}-RETURNED-BILL`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-RETURNED-BILL-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-RETURN-BILL-1`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          billReturnCycles: [
            {
              returnedDate: "2026-06-09",
              reason: "Correction",
              resubmittedDate: "2026-06-10",
              remarks: "QA returned bill cycle",
            },
          ],
          paymentDate: "2026-06-15",
          paymentMode: "Online",
          actualPaymentCapital: "100000",
        }),
      ],
    }),
    file(`${prefix}-SUPP-BILL`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-SUPP-BILL-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-SUPP-MAIN-BILL`,
          billAmountCapital: "90000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Offline",
          actualPaymentCapital: "90000",
          supplementaryBills: [
            {
              billNo: `${prefix}-SUPP-1`,
              billAmountCapital: "10000",
              billAmountRevenue: "",
              billSentForPaymentDate: "2026-06-20",
              billReturnCycles: [
                {
                  returnedDate: "2026-06-21",
                  reason: "Correction",
                  resubmittedDate: "2026-06-22",
                  remarks: "QA supplementary returned cycle",
                },
              ],
              paymentDate: "2026-06-25",
              paymentMode: "Online",
              actualPaymentCapital: "10000",
              actualPaymentRevenue: "",
              remarks: "QA supplementary payment",
            },
          ],
        }),
      ],
    }),
  ];
}

function paymentPendingEdgeFiles() {
  return [
    file(`${prefix}-RETURNED-BILL-PENDING`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-RETURNED-BILL-PENDING-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-RETURN-PENDING-BILL`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          billReturnCycles: [
            {
              returnedDate: "2026-06-09",
              reason: "Correction pending with firm",
              resubmittedDate: "",
              remarks: "QA returned bill still pending",
            },
          ],
        }),
      ],
    }),
    file(`${prefix}-ADVANCE-PAID`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-ADVANCE-PAID-SO`,
          completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
          stageDelivery: "Yes",
          stageDeliveryCount: "1",
          stagePayment: "Yes",
          advancePayment: "Yes",
          stageDeliveries: [
            {
              deliveryPeriodStartDate: "2026-05-15",
              dpDate: "2026-08-14",
              stageAmountCapital: "70000",
              currentMilestone: "Delivery",
              completedMilestones: [],
            },
          ],
          advancePaymentDetail: {
            stageAmountCapital: "30000",
            stageAmountRevenue: "",
            billPreparationDate: "2026-05-20",
            billNo: `${prefix}-ADVANCE-BILL-1`,
            billSentForPaymentDate: "2026-05-22",
            billReturnCycles: [
              {
                returnedDate: "2026-05-23",
                reason: "Correction",
                resubmittedDate: "2026-05-24",
                remarks: "QA advance returned bill cycle",
              },
            ],
            paymentDate: "2026-05-30",
            paymentMode: "Online",
            actualPaymentCapital: "30000",
            actualPaymentRevenue: "",
          },
        }),
      ],
    }),
    file(`${prefix}-ADVANCE-PENDING`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-ADVANCE-PENDING-SO`,
          completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
          stageDelivery: "Yes",
          stageDeliveryCount: "1",
          stagePayment: "Yes",
          advancePayment: "Yes",
          stageDeliveries: [
            {
              deliveryPeriodStartDate: "2026-05-15",
              dpDate: "2026-08-14",
              stageAmountCapital: "75000",
              currentMilestone: "Delivery",
              completedMilestones: [],
            },
          ],
          advancePaymentDetail: {
            stageAmountCapital: "25000",
            stageAmountRevenue: "",
            billPreparationDate: "2026-05-20",
            billNo: `${prefix}-ADVANCE-PENDING-BILL`,
            billSentForPaymentDate: "2026-05-22",
            billReturnCycles: [],
            paymentDate: "",
            paymentMode: "",
            actualPaymentCapital: "",
            actualPaymentRevenue: "",
          },
        }),
      ],
    }),
  ];
}

function stageOverlapFiles() {
  return [
    file(`${prefix}-STAGE-OVERLAP`, {
      supplyOrders: [
        order({
          soNo: `${prefix}-STAGE-OVERLAP-SO`,
          stageDelivery: "Yes",
          stageDeliveryCount: "2",
          stagePayment: "Yes",
          stageDeliveries: [
            {
              deliveryPeriodStartDate: "2026-05-15",
              dpDate: "2026-06-14",
              dpExtension: "Yes",
              dpExtensionCount: "1",
              revisedDp: "2026-07-15",
              stageAmountCapital: "50000",
              currentMilestone: "",
              completedMilestones: ["Delivery"],
              materialReceiptDate: "2026-07-10",
              irPreparationDate: "2026-07-11",
              irReceiptDate: "2026-07-12",
              billPreparationDate: "2026-07-13",
              billNo: `${prefix}-OVERLAP-BILL-1`,
              billSentForPaymentDate: "2026-07-14",
              paymentDate: "2026-07-20",
              paymentMode: "Online",
              actualPaymentCapital: "50000",
            },
            {
              deliveryPeriodStartDate: "2026-06-15",
              dpDate: "2026-08-14",
              stageAmountCapital: "50000",
              currentMilestone: "Delivery",
              completedMilestones: [],
            },
          ],
        }),
      ],
    }),
  ];
}

function supplyOrderEdgeFiles() {
  return [
    file(`${prefix}-MULTI-SO`, {
      noOfSo: "2",
      supplyOrders: [
        order({
          soNo: `${prefix}-MULTI-SO-LIVE`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          soValueCapital: "60000",
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-MULTI-SO-BILL-1`,
          billAmountCapital: "60000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Online",
          actualPaymentCapital: "60000",
        }),
        order({
          soNo: `${prefix}-MULTI-SO-CANCELLED`,
          soValueCapital: "40000",
          dpDate: "2026-08-14",
          soCancelled: "Yes",
          soCancelledDate: "2026-05-25",
          completedMilestones: ["Financial Sanction", "Supply Order"],
        }),
      ],
    }),
    file(`${prefix}-SHORTCLOSED-PENDING`, {
      noOfSo: "1",
      supplyOrders: [
        order({
          soNo: `${prefix}-SHORTCLOSED-PENDING-SO`,
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-SHORTCLOSED-PENDING-BILL`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          shortclosure: "Yes",
          shortclosureDate: "2026-06-20",
        }),
      ],
    }),
  ];
}

function customSettingsFiles() {
  return [
    file(`${prefix}-CUSTOM-GS`, {
      division: "CSeG",
      fileType: "DcPP (G&S)",
      fileTypeGroup: "goodsServices",
      mode: "OBM",
      firmType: "Startup",
      indentor: "QA Custom Indentor CSeG",
      supplyOrders: [
        order({
          soNo: `${prefix}-CUSTOM-GS-SO`,
          firmType: "Startup",
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          materialReceiptDate: "2026-06-01",
          irPreparationDate: "2026-06-03",
          irReceiptDate: "2026-06-05",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-CUSTOM-GS-BILL`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Online",
          actualPaymentCapital: "100000",
        }),
      ],
    }),
    file(`${prefix}-CUSTOM-CONTRACT`, {
      division: "SCPC",
      fileType: "CAPSI",
      fileTypeGroup: "contract",
      mode: "LPC",
      ir: "No",
      biddingStageOver: "No",
      bidNumber: "",
      bidDate: "",
      bidOpeningDate: "",
      bidOpened: "",
      indentor: "QA Custom Indentor SCPC",
      supplyOrders: [
        order({
          soNo: `${prefix}-CUSTOM-CONTRACT-SO`,
          firmType: "MSE (Women)",
          completedMilestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Job Completion",
            "Bill preparation",
            "Bill sent for payment",
            "Payment",
          ],
          jobCompletionDate: "2026-06-01",
          materialReceiptDate: "",
          irPreparationDate: "",
          irReceiptDate: "",
          billPreparationDate: "2026-06-07",
          billNo: `${prefix}-CUSTOM-CONTRACT-BILL`,
          billAmountCapital: "100000",
          billSentForPaymentDate: "2026-06-08",
          paymentDate: "2026-06-15",
          paymentMode: "Offline",
          actualPaymentCapital: "100000",
        }),
      ],
    }),
  ];
}

const batches = {
  "clean-baseline": cleanBaselineFiles,
  "payment-edge": paymentEdgeFiles,
  "payment-pending-edge": paymentPendingEdgeFiles,
  "stage-overlap": stageOverlapFiles,
  "supply-order-edge": supplyOrderEdgeFiles,
  "custom-settings": customSettingsFiles,
};

async function cleanup(token) {
  const search = await api(
    `/api/files/search?selectedYear=__all_files__&freeText=${encodeURIComponent(prefix)}&page=1&pageSize=500`,
    token,
  );
  for (const row of search.files ?? []) {
    if (String(row.uniqueCode ?? "").startsWith(prefix)) {
      await api(`/api/files/${row.id}`, token, { method: "DELETE" }).catch(() => undefined);
    }
  }
}

async function getSeededAnomalies(token, fileIds) {
  const payload = await api(
    "/api/dashboard/suspected-anomalies?selectedYear=__all_files__&fileYear=all",
    token,
  );
  const wanted = new Set(fileIds);
  return (payload.rows ?? []).filter((row) => wanted.has(row.fileId));
}

async function main() {
  const buildBatch = batches[batch];
  if (!buildBatch) throw new Error(`Unknown SCENARIO_BATCH ${batch}`);
  const token = await login();
  const saved = [];
  try {
    if (checkOnly) {
      const search = await api(
        `/api/files/search?selectedYear=__all_files__&freeText=${encodeURIComponent(prefix)}&page=1&pageSize=500`,
        token,
      );
      for (const row of search.files ?? []) {
        if (String(row.uniqueCode ?? "").startsWith(prefix)) saved.push(row);
      }
    } else {
      await cleanup(token);
      for (const payload of buildBatch()) {
        const result = await api("/api/files", token, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        saved.push(result.file);
      }
    }
    const anomalies = await getSeededAnomalies(token, saved.map((row) => row.id));
    console.log(
      JSON.stringify(
        {
          batch,
          prefix,
          checkOnly,
          seeded: saved.map((row) => ({ id: row.id, uniqueCode: row.uniqueCode })),
          anomalies,
          stopped: anomalies.length > 0,
          keptFiles: keepFiles || anomalies.length > 0,
        },
        null,
        2,
      ),
    );
    if (anomalies.length) process.exitCode = 2;
  } finally {
    if (!checkOnly && !keepFiles) {
      const anomalies = saved.length
        ? await getSeededAnomalies(token, saved.map((row) => row.id)).catch(() => [])
        : [];
      if (!anomalies.length) await cleanup(token);
    }
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
