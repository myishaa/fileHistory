import { pool } from "../src/db/pool.js";
import { saveUserSession, deleteSession } from "../src/utils/auth.js";
import { searchFiles } from "../src/utils/file-search.js";
import { buildReportsSummary } from "../src/utils/report-summary.js";
import {
  advancePaymentEntries,
  expectedSupplyOrders,
  filePaymentOrders,
  fileSupplyOrders,
  getDeliveryPeriodDate,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isExpiredDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders,
} from "../src/utils/effective-deliveries.js";
import type { FileRecord, SupplyOrderDetail } from "../src/types.js";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const QA_PREFIX = "QA-PERMUTATION-WORKFLOW";
const YEAR = "2026-27";
const DIVISION = "ACC";
const TODAY = "2026-07-31";
const CASE_COUNT = Number(process.env.QA_CASE_COUNT ?? 100);

type CounterExpectation = {
  milestone: string;
  column: string;
  expected: number;
};

type CaseResult = {
  code: string;
  label: string;
  checks: Array<{ label: string; ok: boolean; detail?: string }>;
};

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function filled(value: string | undefined) {
  return Boolean(value?.trim());
}

function beforeToday(value: string | undefined) {
  return filled(value) && value! < TODAY;
}

function normalize(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function completed(order: SupplyOrderDetail, milestone: string) {
  const key = normalize(milestone);
  return order.completedMilestones?.some((item) => normalize(item) === key) ?? false;
}

function deliveryApplicable(file: FileRecord) {
  const type = (file.fileType ?? "").trim().toLowerCase();
  return !["amc", "mpc", "cars", "o&m"].includes(type);
}

function cancelled(file: FileRecord, order?: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(file.soCancelled) || isYes(order?.soCancelled);
}

function supplyOrderComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!filled(order.soNo)) return false;
  if (!isYes(file.gem) && !filled(order.gemSoNo)) return false;
  if (!filled(order.soDate)) return false;
  if (!filled(order.soValueCapital) && !filled(order.soValueRevenue)) return false;
  if (!filled(order.firm)) return false;
  if (!filled(order.firmType)) return false;
  if (!isYes(order.stageDelivery) && order.stageDelivery !== "No") return false;
  if (isYes(order.stageDelivery)) {
    if (!filled(order.stageDeliveryCount)) return false;
    if (!isYes(order.stagePayment) && order.stagePayment !== "No") return false;
    if (isYes(order.stagePayment) && !isYes(order.advancePayment) && order.advancePayment !== "No") {
      return false;
    }
  }
  return true;
}

function bgApplicable(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const coverage = order.bgCoverageType ?? "";
  if (category === "PSB") {
    return isYes(order.psbApplicable) && (coverage === "PSB" || coverage === "PSB and PWB separately");
  }
  if (category === "PWB") {
    return isYes(file.bg) && (coverage === "PWB" || coverage === "PSB and PWB separately");
  }
  if (category === "PSB+PWB") return isYes(file.bg) && coverage === "PSB+PWB";
  return false;
}

function bgReceived(order: SupplyOrderDetail, category: string) {
  if (category === "PSB") return filled(order.psbBgReceivedDate) || completed(order, "PSB");
  if (category === "PWB") return filled(order.pwbBgReceivedDate) || completed(order, "PWB");
  if (category === "PSB+PWB") return filled(order.combinedBgReceivedDate) || completed(order, "PSB+PWB");
  return false;
}

function bgValidity(order: SupplyOrderDetail, category: string) {
  if (category === "PSB") return order.psbBgValidityDate;
  if (category === "PWB") return order.pwbBgValidityDate;
  if (category === "PSB+PWB") return order.combinedBgValidityDate;
  return undefined;
}

function bgReturned(order: SupplyOrderDetail, category: string) {
  if (category === "PSB") return filled(order.psbBgReturnDate);
  if (category === "PWB") return filled(order.pwbBgReturnDate);
  if (category === "PSB+PWB") return filled(order.combinedBgReturnDate);
  return false;
}

function paymentStarted(file: FileRecord, order: SupplyOrderDetail) {
  if (deliveryApplicable(file)) return filled(order.materialReceiptDate);
  return beforeToday(getDeliveryPeriodDate(order));
}

function countExpected(file: FileRecord): CounterExpectation[] {
  const rawOrders = rawSupplyOrders(file).filter((order) => !cancelled(file, order));
  const expectedOrders = expectedSupplyOrders(file).filter((order) => !cancelled(file, order));
  const deliveryRows = fileSupplyOrders(file).filter((order) => !cancelled(file, order));
  const paymentRows = filePaymentOrders(file).filter((order) => !cancelled(file, order));
  const expectations: CounterExpectation[] = [];

  const push = (milestone: string, column: string, expected: number) => {
    expectations.push({ milestone, column, expected });
  };

  push("Supply Order", "Pending", expectedOrders.filter((order) => filled(order.financialSanctionDate) && !supplyOrderComplete(file, order)).length);
  push("Supply Order", "Placed", rawOrders.filter((order) => supplyOrderComplete(file, order)).length);
  push("Supply Order", "Live", rawOrders.filter((order) => supplyOrderComplete(file, order) && !filled(order.paymentDate)).length);

  push("Delivery Period", "Valid", deliveryRows.filter((order) => isValidDeliveryPeriodEntry(file, order)).length);
  push("Delivery Period", "Expired", deliveryRows.filter((order) => isExpiredDeliveryPeriodEntry(file, order)).length);

  push("Delivery", "Completed", deliveryRows.filter((order) => deliveryApplicable(file) && filled(order.soDate) && filled(order.materialReceiptDate)).length);
  push("Delivery", "Pending", deliveryRows.filter((order) => deliveryApplicable(file) && filled(order.soDate) && !filled(order.materialReceiptDate) && filled(getDeliveryPeriodDate(order))).length);

  push("IR Preparation", "Completed", deliveryRows.filter((order) => isYes(file.ir) && completed(order, "IR Preparation")).length);
  push("IR Preparation", "Pending", deliveryRows.filter((order) => isYes(file.ir) && filled(order.materialReceiptDate) && !filled(order.irPreparationDate)).length);
  push("IR Receipt", "Completed", deliveryRows.filter((order) => isYes(file.ir) && completed(order, "IR Receipt")).length);
  push("IR Receipt", "Pending", deliveryRows.filter((order) => isYes(file.ir) && filled(order.irPreparationDate) && !filled(order.irReceiptDate)).length);

  push("Bill preparation", "Completed", paymentRows.filter((order) => completed(order, "Bill preparation")).length);
  push("Bill preparation", "Pending", paymentRows.filter((order) => normalize(order.currentMilestone) === "billpreparation" && !filled(order.billPreparationDate)).length);
  push("Bill sent for payment", "Completed", paymentRows.filter((order) => completed(order, "Bill sent for payment")).length);
  push("Bill sent for payment", "Pending", paymentRows.filter((order) => filled(order.billPreparationDate) && !filled(order.billSentForPaymentDate)).length);
  push("Payment", "Completed", paymentRows.filter((order) => filled(order.paymentDate)).length);
  push("Payment", "Pending", paymentRows.filter((order) => paymentStarted(file, order) && !filled(order.paymentDate)).length);

  push("Advance Payment", "Completed", advancePaymentEntries([file]).filter(({ order }) => isAdvancePaymentPaid(order)).length);
  push("Advance Payment", "Pending", advancePaymentEntries([file]).filter(({ order }) => isAdvancePaymentPending(order)).length);

  for (const category of ["PSB", "PWB", "PSB+PWB"]) {
    push(category, "Received", rawOrders.filter((order) => bgApplicable(file, order, category) && bgReceived(order, category)).length);
    push(category, "Pending", rawOrders.filter((order) => {
      if (!bgApplicable(file, order, category) || bgReceived(order, category)) return false;
      return category === "PWB" ? filled(order.materialReceiptDate) : filled(order.financialSanctionDate);
    }).length);
    push(category, "To be returned", rawOrders.filter((order) => {
      if (!bgApplicable(file, order, category) || !bgReceived(order, category) || bgReturned(order, category)) return false;
      if (category === "PSB") return filled(order.irReceiptDate);
      return filled(order.paymentDate) && beforeToday(bgValidity(order, category));
    }).length);
    push(category, "Returned", rawOrders.filter((order) => bgApplicable(file, order, category) && bgReturned(order, category)).length);
  }

  return expectations;
}

function statusCount(file: FileRecord, milestone: string, column: string) {
  const reports = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "all",
    expectedCashOutgoDays: 0,
  });
  for (const group of reports.statusSummaryGroups) {
    const row = group.rows.find((item) => item.milestone === milestone);
    const value = row?.counts[column];
    if (typeof value === "number") return value;
  }
  return 0;
}

function clickerMatches(file: FileRecord, milestone: string, column: string) {
  const dashboardFilter = `statusSummary:${encodeURIComponent(milestone)}:${encodeURIComponent(column)}`;
  return searchFiles([file], { dashboardFilter } as Parameters<typeof searchFiles>[1]).length === 1;
}

function base(code: string, patch: Record<string, unknown> = {}) {
  return {
    title: code,
    uniqueCode: code,
    fileNo: code,
    division: DIVISION,
    year: YEAR,
    activeYears: [YEAR],
    receivedDate: "2026-07-01",
    date: "2026-07-01",
    indentor: "QA Permutation Indentor",
    demandDescription: `${code} permutation QA`,
    valueCapital: "100000",
    valueRevenue: "",
    currency: "INR",
    exchangeRate: "1",
    fileType: "Goods & Services",
    mode: "PBM",
    gem: "Yes",
    gte: "No",
    tcec: "No",
    highValue: "No",
    ad: "No",
    rqa: "No",
    ifa: "No",
    bg: "No",
    psb: "No",
    ir: "No",
    rfpVetting: "No",
    demandCancelled: "No",
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA"],
    noOfSo: "1",
    supplyOrders: [],
    ...patch,
  };
}

function makeOrder(code: string, index: number, patch: Partial<SupplyOrderDetail> = {}): SupplyOrderDetail {
  const value = String(10000 + index * 5000);
  return {
    financialSanctionDate: "2026-07-05",
    currentMilestone: "Delivery",
    completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
    psbApplicable: "No",
    bgCoverageType: "None",
    soNo: `${code}-SO-${index + 1}`,
    gemSoNo: `${code}-GEM-${index + 1}`,
    soDate: "2026-07-10",
    soValueCapital: value,
    firm: `QA Firm ${index + 1}`,
    firmType: "MSME",
    dpDate: index % 2 === 0 ? "2026-07-25" : "2026-08-20",
    stageDelivery: "No",
    stagePayment: "No",
    advancePayment: "No",
    paymentMode: "Online",
    ...patch,
  };
}

function applyBg(order: SupplyOrderDetail, mode: number, state: number) {
  if (mode === 1) {
    order.psbApplicable = "Yes";
    order.bgCoverageType = "PSB";
    if (state >= 4) order.psbBgReceivedDate = "2026-07-11";
    if (state >= 4) order.psbBgValidityDate = state >= 8 ? "2026-07-20" : "2026-12-31";
    if (state >= 9) order.psbBgReturnDate = "2026-07-30";
  } else if (mode === 2) {
    order.bgCoverageType = "PWB";
    if (state >= 5) order.pwbBgReceivedDate = "2026-07-22";
    if (state >= 5) order.pwbBgValidityDate = state >= 8 ? "2026-07-20" : "2027-12-31";
    if (state >= 9) order.pwbBgReturnDate = "2026-07-30";
  } else if (mode === 3) {
    order.psbApplicable = "Yes";
    order.bgCoverageType = "PSB and PWB separately";
    if (state >= 3) {
      order.psbBgReceivedDate = "2026-07-11";
      order.psbBgValidityDate = "2026-12-31";
    }
    if (state >= 6) {
      order.pwbBgReceivedDate = "2026-07-22";
      order.pwbBgValidityDate = state >= 8 ? "2026-07-20" : "2027-12-31";
    }
  } else if (mode === 4) {
    order.bgCoverageType = "PSB+PWB";
    if (state >= 2) {
      order.combinedBgReceivedDate = "2026-07-06";
      order.combinedBgValidityDate = state >= 8 ? "2026-07-20" : "2027-12-31";
    }
    if (state >= 9) order.combinedBgReturnDate = "2026-07-30";
  }
}

function applyWorkflow(order: SupplyOrderDetail, fileType: string, state: number, withIr: boolean) {
  const nonDelivery = ["AMC", "MPC", "O&M", "CARS"].includes(fileType);
  if (state === 0) {
    order.soNo = "";
    order.gemSoNo = "";
    order.soDate = "";
    order.soValueCapital = "";
    order.firm = "";
    order.firmType = "";
    order.currentMilestone = "Supply Order";
    order.completedMilestones = ["Financial Sanction"];
    return;
  }
  if (!nonDelivery && state >= 3) {
    order.materialReceiptDate = "2026-07-20";
    order.completedMilestones = [...(order.completedMilestones ?? []), "Delivery"];
  }
  if (withIr && !nonDelivery && state >= 5) {
    order.irPreparationDate = "2026-07-21";
    order.completedMilestones = [...(order.completedMilestones ?? []), "IR Preparation"];
  }
  if (withIr && !nonDelivery && state >= 6) {
    order.irReceiptDate = "2026-07-22";
    order.completedMilestones = [...(order.completedMilestones ?? []), "IR Receipt"];
  }
  if (state >= 7) {
    order.billPreparationDate = "2026-07-23";
    order.completedMilestones = [...(order.completedMilestones ?? []), "Bill preparation"];
  }
  if (state >= 8) {
    order.billSentForPaymentDate = "2026-07-24";
    order.completedMilestones = [...(order.completedMilestones ?? []), "Bill sent for payment"];
  }
  if (state >= 9) {
    order.paymentDate = "2026-07-30";
    order.actualPaymentCapital = order.soValueCapital;
    order.completedMilestones = [...(order.completedMilestones ?? []), "Payment"];
    order.currentMilestone = "";
  }
  if (nonDelivery && state >= 3 && state < 9) order.currentMilestone = "Payment";
}

function applyStages(order: SupplyOrderDetail, variant: number, state: number) {
  if (variant === 0 || state === 0) return;
  order.stageDelivery = "Yes";
  order.stagePayment = variant === 1 || variant === 2 ? "Yes" : "No";
  order.advancePayment = variant === 2 ? "Yes" : "No";
  order.stageDeliveryCount = "2";
  const firstCompleted = [
    ...(state >= 3 ? ["Delivery"] : []),
    ...(state >= 7 && variant !== 3 ? ["Bill preparation"] : []),
    ...(state >= 8 && variant !== 3 ? ["Bill sent for payment"] : []),
    ...(state >= 9 && variant !== 3 ? ["Payment"] : []),
  ];
  const secondCompleted = [
    ...(state >= 4 ? ["Delivery"] : []),
    ...(state >= 7 && variant !== 3 ? ["Bill preparation"] : []),
  ];
  order.stageDeliveries = [
    {
      stageAmountCapital: "4000",
      deliveryPeriodStartDate: "2026-07-10",
      dpDate: "2026-07-20",
      materialReceiptDate: state >= 3 ? "2026-07-18" : "",
      billPreparationDate: state >= 7 && variant !== 3 ? "2026-07-23" : "",
      billSentForPaymentDate: state >= 8 && variant !== 3 ? "2026-07-24" : "",
      paymentDate: state >= 9 && variant !== 3 ? "2026-07-30" : "",
      actualPaymentCapital: state >= 9 && variant !== 3 ? "4000" : "",
      completedMilestones: firstCompleted,
    },
    {
      stageAmountCapital: "6000",
      deliveryPeriodStartDate: "2026-07-21",
      dpDate: "2026-08-20",
      materialReceiptDate: state >= 4 ? "2026-07-29" : "",
      billPreparationDate: state >= 7 && variant !== 3 ? "2026-07-30" : "",
      completedMilestones: secondCompleted,
    },
  ];
  if (variant === 2) {
    order.advancePaymentDetail = {
      currentMilestone: state >= 9 ? "" : "Advance Payment",
      completedMilestones: state >= 9 ? ["Advance Payment"] : [],
      stageAmountCapital: "2000",
      billPreparationDate: "2026-07-12",
      billSentForPaymentDate: "2026-07-13",
      paymentDate: state >= 9 ? "2026-07-14" : "",
      actualPaymentCapital: state >= 9 ? "2000" : "",
    };
  }
}

function buildCase(index: number) {
  const fileTypes = ["Goods & Services", "AMC", "MPC", "O&M", "CARS"];
  const fileType = fileTypes[index % fileTypes.length];
  const bgMode = Math.floor(index / 5) % 5;
  const state = Math.floor(index / 25) * 2 + (index % 5);
  const stageVariant = Math.floor(index / 10) % 4;
  const multiOrder = index % 10 === 9;
  const withIr = index % 3 !== 1;
  const code = `${QA_PREFIX}-${String(index + 1).padStart(3, "0")}`;
  const bg = bgMode === 0 ? "No" : "Yes";
  const first = makeOrder(code, 0);
  applyWorkflow(first, fileType, Math.min(state, 9), withIr);
  applyBg(first, bgMode, Math.min(state, 9));
  if (fileType === "Goods & Services") applyStages(first, stageVariant, Math.min(state, 9));

  const orders = [first];
  if (multiOrder) {
    const second = makeOrder(code, 1, { dpDate: "2026-08-25", soValueCapital: "15000" });
    applyWorkflow(second, fileType, Math.min(state + 1, 9), withIr);
    applyBg(second, (bgMode + 1) % 5, Math.min(state + 1, 9));
    orders.push(second);
  }

  return {
    label: `${fileType}, bgMode=${bgMode}, state=${Math.min(state, 9)}, stage=${stageVariant}, orders=${orders.length}`,
    payload: { ...base(code, { fileType, bg, ir: withIr ? "Yes" : "No" }), noOfSo: String(orders.length), supplyOrders: orders },
  };
}

async function getAdminUserId() {
  const result = await pool.query<{ id: string }>(
    "select id from app_users where username = 'ovais' and role = 'admin' and is_active = true limit 1",
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Active admin user 'ovais' not found.");
  return id;
}

async function cleanupQaFiles() {
  await pool.query("delete from files where unique_code like $1", [`${QA_PREFIX}%`]);
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: `recordkeeper_session=${encodeURIComponent(token)}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => undefined)) as T | { error?: string } | undefined;
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed ${response.status}: ${
        (body as { error?: string } | undefined)?.error ?? "unknown error"
      }`,
    );
  }
  return body as T;
}

async function savePayload(payload: Record<string, unknown>, token: string) {
  const result = await api<{ file: FileRecord }>("/api/files", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.file;
}

function verifyCase(file: FileRecord, label: string): CaseResult {
  const checks: CaseResult["checks"] = [];
  for (const item of countExpected(file)) {
    const actual = statusCount(file, item.milestone, item.column);
    checks.push({
      label: `${item.milestone} ${item.column} counter`,
      ok: actual === item.expected,
      detail: actual === item.expected ? undefined : `expected ${item.expected}, got ${actual}`,
    });
    if (item.expected > 0) {
      const clickerOk = clickerMatches(file, item.milestone, item.column);
      checks.push({
        label: `${item.milestone} ${item.column} clicker`,
        ok: clickerOk,
        detail: clickerOk ? undefined : "counter was non-zero but clicker did not return file",
      });
    }
  }
  return { code: file.uniqueCode ?? file.fileNo ?? file.id, label, checks };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await cleanupQaFiles();
  const token = await saveUserSession(await getAdminUserId());
  const results: CaseResult[] = [];

  try {
    for (let index = 0; index < CASE_COUNT; index += 1) {
      const testCase = buildCase(index);
      const saved = await savePayload(testCase.payload, token);
      results.push(verifyCase(saved, testCase.label));
    }

    const failures = results.flatMap((result) =>
      result.checks
        .filter((check) => !check.ok)
        .map((check) => ({ code: result.code, label: result.label, check })),
    );
    const totalChecks = results.reduce((sum, result) => sum + result.checks.length, 0);
    console.log(`Permutation cases: ${results.length}`);
    console.log(`Total counter/clicker checks: ${totalChecks}`);
    console.log(`Failures: ${failures.length}`);
    if (failures.length) {
      for (const failure of failures.slice(0, 80)) {
        console.log(`- ${failure.code} (${failure.label}): ${failure.check.label} - ${failure.check.detail ?? "failed"}`);
      }
      if (failures.length > 80) console.log(`... ${failures.length - 80} more failures`);
      process.exitCode = 1;
    } else {
      const samples = results.slice(0, 10).map((result) => `${result.code}: ${result.label}`);
      console.log("Sample cases:");
      for (const sample of samples) console.log(`- ${sample}`);
    }
  } finally {
    await deleteSession(token);
    await cleanupQaFiles();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
