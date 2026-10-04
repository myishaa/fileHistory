import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("../backend/node_modules/pg");

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://myishasiddiqui@localhost:5432/recordkeeper";

const pool = new Pool({ connectionString: DATABASE_URL });

const QA_PREFIX = "QA-SEED-";

const fileTypeGroups = {
  "Goods & Services": "goodsServices",
  "DcPP (G&S)": "goodsServices",
  "I&M (G&S)": "goodsServices",
  AMC: "contract",
  MPC: "contract",
  CARS: "contract",
  CAPSI: "contract",
  "O&M": "contract",
  "DcPP (Contract)": "contract",
  "I&M (Contract)": "contract",
};

const requiredFileTypes = Object.keys(fileTypeGroups);
const requiredModes = ["OBM", "PBM", "SBM", "LBM", "LPC", "GeM"];
const requiredFirmTypes = ["MSE", "MSE (SC)", "MSE (Women)", "Non-MSE", "Startup"];

const indentorByDivision = {
  ACC: [
    "QA Logistics Cell",
    "QA Finance Automation Cell",
    "QA Estate Cell",
    "QA Central Stores",
  ],
  CSeG: [
    "QA Cyber Security Group",
    "QA Network Infrastructure Cell",
    "QA Business Continuity Cell",
    "QA Endpoint Security Cell",
  ],
  SCPC: [
    "QA Reliability Test Centre",
    "QA Systems Test Laboratory",
    "QA Programme Support Office",
    "QA Inspection Directorate",
  ],
};

const dates = {
  current: {
    received: "2026-04-08",
    scrutiny: "2026-04-12",
    response: "2026-04-16",
    scrutinyDone: "2026-04-20",
    ifaSent: "2026-04-24",
    ifaFinal: "2026-04-30",
    cfaSent: "2026-05-04",
    cfa: "2026-05-11",
    bid: "2026-05-22",
    preBid: "2026-05-29",
    bidOpen: "2026-06-06",
    preTcec: "2026-06-12",
    preTcecMinutes: "2026-06-16",
    postTcec: "2026-06-22",
    postTcecMinutes: "2026-06-27",
    cnc: "2026-07-02",
    cncApproval: "2026-07-09",
    fs: "2026-07-15",
    so: "2026-07-22",
    dp: "2026-10-31",
    delivery: "2026-08-18",
    irPrep: "2026-08-21",
    irReceipt: "2026-08-24",
    billPrep: "2026-08-28",
    billSent: "2026-09-01",
    returned: "2026-09-04",
    resubmitted: "2026-09-08",
    payment: "2026-09-10",
    suppSent: "2026-09-02",
    suppReturned: "2026-09-05",
    suppResubmitted: "2026-09-09",
    suppPayment: "2026-09-11",
  },
  previous: {
    received: "2025-05-06",
    scrutiny: "2025-05-09",
    response: "2025-05-14",
    scrutinyDone: "2025-05-16",
    ifaSent: "2025-05-21",
    ifaFinal: "2025-05-28",
    cfaSent: "2025-06-02",
    cfa: "2025-06-10",
    bid: "2025-06-22",
    preBid: "2025-06-27",
    bidOpen: "2025-07-06",
    preTcec: "2025-07-12",
    preTcecMinutes: "2025-07-16",
    postTcec: "2025-07-22",
    postTcecMinutes: "2025-07-27",
    cnc: "2025-08-02",
    cncApproval: "2025-08-09",
    fs: "2025-08-15",
    so: "2025-08-22",
    dp: "2025-12-31",
    delivery: "2025-12-12",
    irPrep: "2025-12-15",
    irReceipt: "2025-12-18",
    billPrep: "2025-12-22",
    billSent: "2026-01-03",
    payment: "2026-02-12",
  },
};

function workflow(d, currentMilestone, completedMilestones = [], patch = {}) {
  return {
    received_date: d.received,
    scrutiny_date: completedMilestones.includes("Scrutiny") ? d.scrutiny : null,
    scrutiny_response_date: completedMilestones.includes("Scrutiny") ? d.response : null,
    scrutiny_completion_date: completedMilestones.includes("Scrutiny") ? d.scrutinyDone : null,
    imms: completedMilestones.includes("Controlling") ? "QA/CTRL/MMG" : null,
    imms_date: completedMilestones.includes("Controlling") ? d.scrutinyDone : null,
    ifa_sent_date: completedMilestones.includes("IFA") ? d.ifaSent : null,
    ifa_final_date: completedMilestones.includes("IFA") ? d.ifaFinal : null,
    cfa_sent_date: completedMilestones.includes("CFA") ? d.cfaSent : null,
    cfa_date: completedMilestones.includes("CFA") ? d.cfa : null,
    pre_tcec_date: completedMilestones.includes("Pre-TCEC") ? d.preTcec : null,
    pre_tcec_minutes_date: completedMilestones.includes("Pre-TCEC") ? d.preTcecMinutes : null,
    pre_tcec_committee_no: completedMilestones.includes("Pre-TCEC") ? "QA-TCEC-01" : null,
    tender_live: completedMilestones.includes("Bidding") ? "Yes" : "No",
    bid_number: completedMilestones.includes("Bidding") ? "QA-BID-01" : null,
    bid_date: completedMilestones.includes("Bidding") ? d.bid : null,
    bid_opening_date: completedMilestones.includes("Bidding") ? d.bidOpen : null,
      bid_opened: completedMilestones.includes("Bidding") ? "YES" : "NO",
      bidding_stage_over: completedMilestones.includes("Bidding") ? "Yes" : "No",
      refloat: "No",
      refloat_pre_bid_meeting: "No",
      rst: "No",
      post_tcec_date: completedMilestones.includes("Post-TCEC") ? d.postTcec : null,
    post_tcec_minutes_date: completedMilestones.includes("Post-TCEC") ? d.postTcecMinutes : null,
    post_tcec_committee_number: completedMilestones.includes("Post-TCEC") ? "QA-TCEC-02" : null,
    cnc_date: completedMilestones.includes("CNC") ? d.cnc : null,
    cnc_approval_date: completedMilestones.includes("CNC") ? d.cncApproval : null,
    financial_sanction_date: completedMilestones.includes("Financial Sanction") ? d.fs : null,
    current_milestone: currentMilestone,
    completedMilestones,
    ...patch,
  };
}

function baseFile({
  code,
  year = "2026-27",
  activeYears,
  division,
  fileType = "Goods & Services",
  mode = "PBM",
  indentor,
  description,
  capital = 0,
  revenue = 0,
  currentMilestone = "Scrutiny",
  completedMilestones = [],
  demandCancelled = false,
  closed = false,
  extra = {},
}) {
  const d = year === "2025-26" ? dates.previous : dates.current;
  const numericCode = code.replace(QA_PREFIX, "");
  const group = fileTypeGroups[fileType] ?? "goodsServices";
  const value = capital || revenue;
  const isContract = group === "contract";
  const wf = workflow(d, currentMilestone, completedMilestones, extra.workflow ?? {});
  const fileClosureDate = extra.file?.file_closure_date ?? (closed ? "2026-09-10" : null);
  const normalizedCompletedMilestones =
    fileClosureDate && !completedMilestones.includes("File Closed")
      ? [...completedMilestones, "File Closed"]
      : completedMilestones;
  return {
    row: {
      title: `QA coverage ${numericCode}`,
      division,
      officer: "QA Seed Officer",
      file_date: d.received,
      year,
      unique_code: code,
      file_no: `QA/${division}/${year}/${numericCode}`,
      indentor,
      demand_description: description,
      value_capital: capital || null,
      value_revenue: revenue || null,
      currency: "INR",
      exchange_rate: 1,
      gte: value >= 25000000 ? "Yes" : "No",
      file_type: fileType,
      file_type_group: group,
      tcec:
        value >= 25000000 ||
        completedMilestones.includes("Pre-TCEC") ||
        completedMilestones.includes("Post-TCEC")
          ? "YES"
          : "NO",
      mode,
      gem: mode === "GeM" ? "Yes" : "No",
      gem_bidding_mode: mode === "GeM" ? "GeM Bid" : null,
      high_value: value >= 50000000 ? "Yes" : "No",
      ad: "No",
      rqa: "No",
      ifa: value >= 10000000 || completedMilestones.includes("IFA") ? "Yes" : "No",
      psb: "No",
      bg: "No",
      ir: isContract ? "No" : "Yes",
      rfp_vetting: "No",
      pre_bid_meeting: completedMilestones.includes("Bidding") ? "Yes" : "No",
      pre_bid_meeting_date: completedMilestones.includes("Bidding") ? d.preBid : null,
      demand_cancelled: demandCancelled ? "Yes" : "No",
      demand_cancelled_date: demandCancelled ? d.cfa : null,
      so_cancelled: "No",
      shortclosure: "No",
      file_closure_date: fileClosureDate,
      no_of_so: 1,
      ...wf,
      ...(extra.file ?? {}),
    },
    activeYears: activeYears ?? [year],
    completedMilestones: normalizedCompletedMilestones,
    remarks: [
      {
        section: "QA coverage seed",
        text: "Structured test record to populate dashboard, reports, finance, analytics and clicker paths.",
      },
    ],
    supplyOrders: extra.supplyOrders ?? [],
  };
}

function order(code, amount, kind = "capital", patch = {}) {
  const d = dates.current;
  return {
    so_no: `QA/SO/${code}`,
    gem_so_no: `QA-GEMC-${code}`,
    so_date: d.so,
    financial_sanction_date: d.fs,
    so_value_capital: kind === "capital" ? amount : null,
    so_value_revenue: kind === "revenue" ? amount : null,
    dp_date: d.dp,
    firm: "QA Northstar Systems Pvt Ltd",
    firm_unique_no: `QA-FIRM-${code}`,
    firm_contact_no: "9999900001",
    firm_city: "New Delhi",
    firm_type: "MSE",
    psb_applicable: "No",
    bg_coverage_type: "None",
    dp_extension: "No",
    ld: "No",
    stage_delivery: "No",
    stage_payment: "No",
    advance_payment: "No",
    current_milestone: "Delivery",
    completed_milestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
    bill_return_cycles: [],
    stage_deliveries: [],
    advance_payment_detail: {},
    supplementary_bills: [],
    demand_cancelled: "No",
    so_cancelled: "No",
    shortclosure: "No",
    firm_rating_values: { quality: 4, timeliness: 4, documentation: 4 },
    ...patch,
  };
}

function deliveredOrder(code, amount, kind = "capital", patch = {}) {
  return order(code, amount, kind, {
    material_receipt_date: dates.current.delivery,
    ir_preparation_date: dates.current.irPrep,
    ir_receipt_date: dates.current.irReceipt,
    bill_preparation_date: dates.current.billPrep,
    bill_no: `QA-BILL-${code}`,
    bill_amount_capital: kind === "capital" ? amount : null,
    bill_amount_revenue: kind === "revenue" ? amount : null,
    bill_sent_for_payment_date: dates.current.billSent,
    current_milestone: "Payment",
    completed_milestones: [
      "Financial Sanction",
      "Supply Order",
      "Delivery Period",
      "Delivery",
      "IR Preparation",
      "IR Receipt",
      "Bill preparation",
      "Bill sent for payment",
    ],
    ...patch,
  });
}

function completedOrder(code, amount, kind = "capital", paymentMode = "PFMS", patch = {}) {
  return deliveredOrder(code, amount, kind, {
    current_milestone: "",
    completed_milestones: [
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
    payment_date: dates.current.payment,
    payment_mode: paymentMode,
    actual_payment_capital: kind === "capital" ? Math.round(amount * 0.98) : null,
    actual_payment_revenue: kind === "revenue" ? Math.round(amount * 0.98) : null,
    ...patch,
  });
}

function jobCompletedOrder(code, amount, patch = {}) {
  return order(code, amount, "revenue", {
    current_milestone: "Bill preparation",
    completed_milestones: ["Financial Sanction", "Supply Order", "Job Completion"],
    job_completion_date: dates.current.delivery,
    ...patch,
  });
}

function completedServiceOrder(code, amount, paymentMode = "PFMS", patch = {}) {
  return jobCompletedOrder(code, amount, {
    current_milestone: "",
    completed_milestones: [
      "Financial Sanction",
      "Supply Order",
      "Job Completion",
      "Bill preparation",
      "Bill sent for payment",
      "Payment",
    ],
    bill_preparation_date: dates.current.billPrep,
    bill_no: `QA-BILL-${code}`,
    bill_amount_revenue: amount,
    bill_sent_for_payment_date: dates.current.billSent,
    payment_date: dates.current.payment,
    payment_mode: paymentMode,
    actual_payment_revenue: Math.round(amount * 0.98),
    ...patch,
  });
}

const files = [
  baseFile({
    code: "QA-SEED-260001",
    division: "ACC",
    indentor: "QA Logistics Cell",
    description: "QA seed: scrutiny pending equipment demand",
    capital: 1200000,
  }),
  baseFile({
    code: "QA-SEED-260002",
    division: "CSeG",
    fileType: "DcPP (G&S)",
    mode: "SBM",
    indentor: "QA Cyber Security Group",
    description: "QA seed: controlling review pending cyber appliance demand",
    capital: 4200000,
    currentMilestone: "Controlling",
    completedMilestones: ["Scrutiny"],
  }),
  baseFile({
    code: "QA-SEED-260003",
    division: "SCPC",
    fileType: "I&M (G&S)",
    mode: "LBM",
    indentor: "QA Systems Test Laboratory",
    description: "QA seed: IFA final approval pending imported lab demand",
    capital: 11800000,
    currentMilestone: "IFA",
    completedMilestones: ["Scrutiny", "Controlling"],
    extra: { workflow: { ifa_sent_date: "2026-05-02", ifa_final_date: null } },
  }),
  baseFile({
    code: "QA-SEED-260004",
    division: "ACC",
    indentor: "QA Finance Automation Cell",
    description: "QA seed: CFA approval pending workstations demand",
    capital: 8600000,
    currentMilestone: "CFA",
    completedMilestones: ["Scrutiny", "Controlling", "IFA"],
  }),
  baseFile({
    code: "QA-SEED-260005",
    division: "CSeG",
    mode: "OBM",
    indentor: "QA Network Infrastructure Cell",
    description: "QA seed: Pre-TCEC pending high-value network demand",
    capital: 31500000,
    currentMilestone: "Pre-TCEC",
    completedMilestones: ["Scrutiny", "Controlling", "IFA", "CFA"],
  }),
  baseFile({
    code: "QA-SEED-260006",
    division: "SCPC",
    fileType: "DcPP (Contract)",
    mode: "PBM",
    indentor: "QA Inspection Directorate",
    description: "QA seed: bidding live contract service demand",
    revenue: 16500000,
    currentMilestone: "Bidding",
    completedMilestones: ["Scrutiny", "Controlling", "IFA", "CFA", "Pre-TCEC"],
  }),
  baseFile({
    code: "QA-SEED-260007",
    division: "ACC",
    fileType: "CARS",
    mode: "OBM",
    indentor: "QA Estate Cell",
    description: "QA seed: Post-TCEC pending vehicle hiring demand",
    revenue: 22400000,
    currentMilestone: "Post-TCEC",
    completedMilestones: ["Scrutiny", "Controlling", "IFA", "CFA", "Pre-TCEC", "Bidding"],
  }),
  baseFile({
    code: "QA-SEED-260008",
    division: "CSeG",
    fileType: "CAPSI",
    mode: "LBM",
    indentor: "QA Endpoint Security Cell",
    description: "QA seed: CNC approval pending manpower demand",
    revenue: 9200000,
    currentMilestone: "CNC",
    completedMilestones: [
      "Scrutiny",
      "Controlling",
      "IFA",
      "CFA",
      "Pre-TCEC",
      "Bidding",
      "Post-TCEC",
    ],
  }),
  baseFile({
    code: "QA-SEED-260009",
    division: "SCPC",
    fileType: "MPC",
    mode: "LPC",
    indentor: "QA Programme Support Office",
    description: "QA seed: financial sanction pending minor works demand",
    revenue: 4800000,
    currentMilestone: "Financial Sanction",
    completedMilestones: [
      "Scrutiny",
      "Controlling",
      "IFA",
      "CFA",
      "Pre-TCEC",
      "Bidding",
      "Post-TCEC",
      "CNC",
    ],
  }),
  baseFile({
    code: "QA-SEED-260010",
    division: "ACC",
    indentor: "QA Central Stores",
    description: "QA seed: S.O. placed, delivery awaited within D.P.",
    capital: 2100000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [order("260010", 2100000, "capital")],
    },
  }),
  baseFile({
    code: "QA-SEED-260011",
    division: "CSeG",
    indentor: "QA Network Infrastructure Cell",
    description: "QA seed: D.P. over, delivery still pending",
    capital: 3700000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [order("260011", 3700000, "capital", { dp_date: "2026-08-01" })],
    },
  }),
  baseFile({
    code: "QA-SEED-260012",
    division: "SCPC",
    indentor: "QA Reliability Test Centre",
    description: "QA seed: material received, IR preparation pending",
    capital: 5400000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260012", 5400000, "capital", {
          material_receipt_date: dates.current.delivery,
          current_milestone: "IR Preparation",
          completed_milestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260013",
    division: "ACC",
    indentor: "QA Logistics Cell",
    description: "QA seed: IR prepared, IR receipt pending",
    capital: 3950000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260013", 3950000, "capital", {
          material_receipt_date: dates.current.delivery,
          ir_preparation_date: dates.current.irPrep,
          current_milestone: "IR Receipt",
          completed_milestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260014",
    division: "CSeG",
    fileType: "AMC",
    indentor: "QA Business Continuity Cell",
    description: "QA seed: job completed, bill preparation pending",
    revenue: 2650000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        jobCompletedOrder("260014", 2650000, { dp_date: "2026-08-17" }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260015",
    division: "SCPC",
    indentor: "QA Systems Test Laboratory",
    description: "QA seed: bill prepared, bill submission pending",
    capital: 6800000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260015", 6800000, "capital", {
          material_receipt_date: dates.current.delivery,
          ir_preparation_date: dates.current.irPrep,
          ir_receipt_date: dates.current.irReceipt,
          bill_preparation_date: dates.current.billPrep,
          bill_no: "QA-BILL-260015",
          bill_amount_capital: 6800000,
          current_milestone: "Bill sent for payment",
          completed_milestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260016",
    division: "ACC",
    indentor: "QA Finance Automation Cell",
    description: "QA seed: normal bill submitted, payment pending",
    capital: 7200000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [deliveredOrder("260016", 7200000, "capital")],
    },
  }),
  baseFile({
    code: "QA-SEED-260017",
    division: "CSeG",
    indentor: "QA Cyber Security Group",
    description: "QA seed: normal bill paid in current FY",
    capital: 8300000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1, file_closure_date: "2026-09-12" },
      supplyOrders: [completedOrder("260017", 8300000, "capital", "PFMS")],
    },
  }),
  baseFile({
    code: "QA-SEED-260018",
    division: "SCPC",
    indentor: "QA Programme Support Office",
    description: "QA seed: returned main bill pending correction",
    revenue: 2450000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        deliveredOrder("260018", 2450000, "revenue", {
          bill_return_cycles: [{ returnedDate: dates.current.returned, reason: "QA invoice mismatch" }],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260019",
    division: "ACC",
    indentor: "QA Estate Cell",
    description: "QA seed: returned main bill resubmitted, payment pending",
    revenue: 3550000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        deliveredOrder("260019", 3550000, "revenue", {
          bill_return_cycles: [
            {
              returnedDate: dates.current.returned,
              reason: "QA consignee certificate missing",
              resubmittedDate: dates.current.resubmitted,
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260020",
    division: "CSeG",
    indentor: "QA Endpoint Security Cell",
    description: "QA seed: returned main bill paid after resubmission",
    revenue: 4400000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1, file_closure_date: "2026-09-12" },
      supplyOrders: [
        completedOrder("260020", 4400000, "revenue", "Offline", {
          bill_return_cycles: [
            {
              returnedDate: dates.current.returned,
              reason: "QA tax worksheet missing",
              resubmittedDate: dates.current.resubmitted,
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260021",
    division: "SCPC",
    fileType: "Goods & Services",
    mode: "SBM",
    indentor: "QA Systems Test Laboratory",
    description: "QA seed: stage payment S.O. with paid, pending and future stages",
    capital: 15000000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "IFA", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260021", 15000000, "capital", {
          stage_delivery: "Yes",
          stage_delivery_count: 3,
          stage_payment: "Yes",
          current_milestone: "Payment",
          stage_deliveries: [
            {
              stageAmountCapital: "5000000",
              deliveryPeriodStartDate: "2026-07-22",
              dpDate: "2026-08-15",
              materialReceiptDate: "2026-08-10",
              irPreparationDate: "2026-08-11",
              irReceiptDate: "2026-08-12",
              billPreparationDate: "2026-08-13",
              billNo: "QA-STG1-260021",
              billSentForPaymentDate: "2026-08-16",
              paymentDate: "2026-08-24",
              paymentMode: "PFMS",
              actualPaymentCapital: "4900000",
              currentMilestone: "",
              completedMilestones: ["Delivery", "Bill preparation", "Bill sent for payment", "Payment"],
              billReturnCycles: [],
            },
            {
              stageAmountCapital: "6000000",
              deliveryPeriodStartDate: "2026-08-16",
              dpDate: "2026-09-10",
              materialReceiptDate: "2026-09-02",
              irPreparationDate: "2026-09-03",
              irReceiptDate: "2026-09-04",
              billPreparationDate: "2026-09-06",
              billNo: "QA-STG2-260021",
              billSentForPaymentDate: "2026-09-09",
              currentMilestone: "Payment",
              completedMilestones: ["Delivery", "Bill preparation", "Bill sent for payment"],
              billReturnCycles: [],
            },
            {
              stageAmountCapital: "4000000",
              deliveryPeriodStartDate: "2026-09-11",
              dpDate: "2026-12-15",
              currentMilestone: "Delivery",
              completedMilestones: [],
              billReturnCycles: [],
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260022",
    division: "ACC",
    fileType: "MPC",
    indentor: "QA Estate Cell",
    description: "QA seed: advance payment bill submitted, payment pending",
    revenue: 5200000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260022", 5200000, "revenue", {
          advance_payment: "Yes",
          current_milestone: "Advance Payment",
          advance_payment_detail: {
            stageAmountRevenue: "1040000",
            billPreparationDate: "2026-08-02",
            billNo: "QA-ADV-260022",
            billSentForPaymentDate: "2026-08-06",
            currentMilestone: "Advance Payment",
            completedMilestones: ["Bill preparation", "Bill sent for payment"],
            billReturnCycles: [],
          },
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260023",
    division: "CSeG",
    fileType: "O&M",
    indentor: "QA Business Continuity Cell",
    description: "QA seed: supplementary bill submitted, payment pending",
    revenue: 6100000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        completedServiceOrder("260023", 6100000, "PFMS", {
          dp_date: "2026-08-16",
          supplementary_bills: [
            {
              billNo: "QA-SUPP-260023",
              billAmountRevenue: "210000",
              billSentForPaymentDate: dates.current.suppSent,
              billReturnCycles: [],
              remarks: "QA escalation claim pending payment",
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260024",
    division: "SCPC",
    fileType: "CAPSI",
    indentor: "QA Programme Support Office",
    description: "QA seed: supplementary bill returned pending correction",
    revenue: 7300000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        completedServiceOrder("260024", 7300000, "PFMS", {
          dp_date: "2026-08-16",
          supplementary_bills: [
            {
              billNo: "QA-SUPP-260024",
              billAmountRevenue: "180000",
              billSentForPaymentDate: dates.current.suppSent,
              billReturnCycles: [
                { returnedDate: dates.current.suppReturned, reason: "QA wage sheet missing" },
              ],
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260025",
    division: "ACC",
    fileType: "AMC",
    indentor: "QA Central Stores",
    description: "QA seed: supplementary returned bill resubmitted",
    revenue: 2950000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        completedServiceOrder("260025", 2950000, "PFMS", {
          dp_date: "2026-08-16",
          supplementary_bills: [
            {
              billNo: "QA-SUPP-260025",
              billAmountRevenue: "95000",
              billSentForPaymentDate: dates.current.suppSent,
              billReturnCycles: [
                {
                  returnedDate: dates.current.suppReturned,
                  reason: "QA SLA certificate missing",
                  resubmittedDate: dates.current.suppResubmitted,
                },
              ],
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260026",
    division: "CSeG",
    fileType: "DcPP (G&S)",
    indentor: "QA Cyber Security Group",
    description: "QA seed: supplementary returned bill paid",
    capital: 9100000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1, file_closure_date: "2026-09-12" },
      supplyOrders: [
        completedOrder("260026", 9100000, "capital", "PFMS", {
          supplementary_bills: [
            {
              billNo: "QA-SUPP-260026",
              billAmountCapital: "265000",
              billSentForPaymentDate: dates.current.suppSent,
              billReturnCycles: [
                {
                  returnedDate: dates.current.suppReturned,
                  reason: "QA licence list required",
                  resubmittedDate: dates.current.suppResubmitted,
                },
              ],
              paymentDate: dates.current.suppPayment,
              paymentMode: "PFMS",
              actualPaymentCapital: "259700",
            },
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260027",
    division: "SCPC",
    fileType: "AMC",
    indentor: "QA Reliability Test Centre",
    description: "QA seed: short-closed S.O. with pending payment",
    revenue: 5100000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        jobCompletedOrder("260027", 5100000, {
          bill_preparation_date: dates.current.billPrep,
          bill_no: "QA-BILL-260027",
          bill_amount_revenue: 5100000,
          bill_sent_for_payment_date: dates.current.billSent,
          current_milestone: "Payment",
          shortclosure: "Yes",
          shortclosure_date: "2026-09-06",
          completed_milestones: [
            "Financial Sanction",
            "Supply Order",
            "Job Completion",
            "Bill preparation",
            "Bill sent for payment",
          ],
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-260028",
    division: "ACC",
    indentor: "QA Logistics Cell",
    description: "QA seed: S.O. cancelled after placement",
    capital: 1750000,
    currentMilestone: "",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("260028", 1750000, "capital", {
          so_cancelled: "Yes",
          so_cancelled_date: "2026-08-05",
          current_milestone: "",
        }),
      ],
    },
  }),
  baseFile({
    code: "QA-SEED-250001",
    year: "2025-26",
    activeYears: ["2025-26", "2026-27"],
    division: "CSeG",
    indentor: "QA Endpoint Security Cell",
    description: "QA seed: previous FY bill still unpaid for carry-forward testing",
    capital: 6400000,
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA", "Bidding", "Financial Sanction"],
    extra: {
      file: { no_of_so: 1 },
      supplyOrders: [
        order("250001", 6400000, "capital", {
          so_date: dates.previous.so,
          financial_sanction_date: dates.previous.fs,
          dp_date: dates.previous.dp,
          material_receipt_date: dates.previous.delivery,
          ir_preparation_date: dates.previous.irPrep,
          ir_receipt_date: dates.previous.irReceipt,
          bill_preparation_date: dates.previous.billPrep,
          bill_no: "QA-BILL-250001",
          bill_amount_capital: 6400000,
          bill_sent_for_payment_date: dates.previous.billSent,
          current_milestone: "Payment",
          completed_milestones: [
            "Financial Sanction",
            "Supply Order",
            "Delivery Period",
            "Delivery",
            "IR Preparation",
            "IR Receipt",
            "Bill preparation",
            "Bill sent for payment",
          ],
        }),
      ],
    },
  }),
];

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null),
  );
}

async function insertReturningId(client, table, data) {
  const compact = compactObject(data);
  const columns = Object.keys(compact);
  const values = Object.values(compact).map((value) =>
    value && typeof value === "object" ? JSON.stringify(value) : value,
  );
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const result = await client.query(
    `insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    values,
  );
  return result.rows[0].id;
}

async function ensureSettings(client) {
  await client.query(
    `
    update app_settings
    set
      file_types = (
        select jsonb_agg(value order by ord)
        from (
          select value, min(ord) as ord
          from (
            select value, ordinality as ord
            from jsonb_array_elements_text(file_types) with ordinality
            union all
            select unnest($1::text[]), 1000 + generate_subscripts($1::text[], 1)
          ) s
          group by value
        ) dedup
      ),
      modes = (
        select jsonb_agg(value order by ord)
        from (
          select value, min(ord) as ord
          from (
            select value, ordinality as ord
            from jsonb_array_elements_text(modes) with ordinality
            union all
            select unnest($2::text[]), 1000 + generate_subscripts($2::text[], 1)
          ) s
          group by value
        ) dedup
      ),
      firm_types = (
        select jsonb_agg(value order by ord)
        from (
          select value, min(ord) as ord
          from (
            select value, ordinality as ord
            from jsonb_array_elements_text(firm_types) with ordinality
            union all
            select unnest($3::text[]), 1000 + generate_subscripts($3::text[], 1)
          ) s
          group by value
        ) dedup
      ),
      file_type_groups = (
        select jsonb_agg(item order by ord)
        from (
          select distinct on (item->>'fileType')
            item,
            ord
          from (
            select item, ordinality as ord
            from jsonb_array_elements(file_type_groups) with ordinality as existing(item, ordinality)
            union all
            select jsonb_build_object('fileType', key, 'group', value), 1000 + row_number() over ()
            from jsonb_each_text($4::jsonb)
          ) merged
          order by item->>'fileType', ord
        ) dedup
      )
    where id = true
    `,
    [requiredFileTypes, requiredModes, requiredFirmTypes, JSON.stringify(fileTypeGroups)],
  );
}

async function ensureIndentors(client, divisions) {
  const admin = await client.query(
    "select id from app_users where role = 'admin' and is_active = true and archived_at is null order by created_at asc limit 1",
  );
  const adminId = admin.rows[0]?.id ?? null;
  for (const [divisionName, names] of Object.entries(indentorByDivision)) {
    const divisionId = divisions.get(divisionName);
    if (!divisionId) continue;
    let serial = 1;
    for (const name of names) {
      await client.query(
        `
        insert into indentors (division_id, name, sf_id, designation, mobile_no, landline_no, email, created_by)
        values ($1, $2, $3, 'QA Seed Indentor', '9999900000', '011-00000000', $4, $5)
        on conflict (division_id, sf_id) where archived_at is null
        do update set name = excluded.name, updated_at = now()
        `,
        [
          divisionId,
          name,
          `QA-${divisionName}-${String(serial).padStart(2, "0")}`,
          `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.invalid`,
          adminId,
        ],
      );
      serial += 1;
    }
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const divisionRows = await client.query(
      "select id, name from divisions where archived_at is null",
    );
    const divisions = new Map(divisionRows.rows.map((row) => [row.name, row.id]));
    for (const division of ["ACC", "CSeG", "SCPC"]) {
      if (!divisions.has(division)) throw new Error(`Required division ${division} not found.`);
    }

    await ensureSettings(client);
    await ensureIndentors(client, divisions);

    await client.query("delete from files where unique_code like $1", [`${QA_PREFIX}%`]);

    const created = [];
    for (const file of files) {
      const divisionId = divisions.get(file.row.division);
      const fileRow = { ...file.row, division_id: divisionId };
      delete fileRow.division;
      delete fileRow.completedMilestones;
      const fileId = await insertReturningId(client, "files", fileRow);
      for (const milestone of file.completedMilestones) {
        await client.query(
          "insert into file_completed_milestones (file_id, milestone) values ($1, $2) on conflict do nothing",
          [fileId, milestone],
        );
      }
      for (const year of file.activeYears) {
        await client.query(
          `
          insert into file_year_activity (file_id, financial_year, status)
          values ($1, $2, 'active')
          on conflict (file_id, financial_year)
          do update set status = 'active'
          `,
          [fileId, year],
        );
      }
      for (const remark of file.remarks) {
        await client.query(
          "insert into file_remarks (file_id, section, text) values ($1, $2, $3)",
          [fileId, remark.section, remark.text],
        );
      }
      let orderIndex = 0;
      for (const supplyOrder of file.supplyOrders) {
        await insertReturningId(client, "supply_orders", {
          file_id: fileId,
          sort_order: orderIndex++,
          ...supplyOrder,
        });
      }
      created.push({
        uniqueCode: file.row.unique_code,
        division: file.row.division,
        year: file.row.year,
        fileType: file.row.file_type,
        valueType: file.row.value_capital ? "Capital" : "Revenue",
        supplyOrders: file.supplyOrders.length,
      });
    }

    await client.query("commit");
    console.log(
      JSON.stringify(
        {
          refreshedPrefix: `${QA_PREFIX}%`,
          createdFiles: created.length,
          createdSupplyOrders: created.reduce((sum, row) => sum + row.supplyOrders, 0),
          files: created,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
