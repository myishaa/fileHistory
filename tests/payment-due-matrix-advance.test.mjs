import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdvanceForecastAmounts,
  getBaseOrderForecastAmounts,
  getCommonStageReceiptExpectedPaymentDate,
  getUnpaidAdvanceForecastEntry,
} from "../src/lib/payment-forecast.ts";

const file = { id: "fixture", currency: "INR" };

function order(overrides = {}) {
  return {
    soValueCapital: "100000",
    soValueRevenue: "0",
    advancePayment: "Yes",
    advancePaymentDetail: {
      stageAmountCapital: "20000",
      stageAmountRevenue: "0",
      expectedPaymentDate: "2026-08-01",
    },
    ...overrides,
  };
}

test("unpaid advance is split from the base S.O. without a bill amount", () => {
  const so = order();
  const base = getBaseOrderForecastAmounts(file, so);
  const advance = getAdvanceForecastAmounts(file, so);

  assert.deepEqual(base, { capital: 80000, revenue: 0 });
  assert.deepEqual(advance, { capital: 20000, revenue: 0 });
  assert.equal(base.capital + advance.capital, 100000);
});

test("an explicit bill amount is preserved without subtracting the advance again", () => {
  const so = order({ billAmountCapital: "80000", billAmountRevenue: "0" });
  assert.deepEqual(getBaseOrderForecastAmounts(file, so), { capital: 80000, revenue: 0 });
});

test("an S.O. without an advance keeps its full planned amount", () => {
  const so = order({ advancePayment: "No", advancePaymentDetail: undefined });
  assert.deepEqual(getBaseOrderForecastAmounts(file, so), { capital: 100000, revenue: 0 });
});

test("blank planned advance allocation falls back to its recorded actual amount", () => {
  const so = order({
    advancePaymentDetail: {
      stageAmountCapital: "",
      stageAmountRevenue: "",
      actualPaymentCapital: "20000",
      actualPaymentRevenue: "0",
      expectedPaymentDate: "2026-08-01",
    },
  });
  const base = getBaseOrderForecastAmounts(file, so);
  const advance = getAdvanceForecastAmounts(file, so);

  assert.deepEqual(base, { capital: 80000, revenue: 0 });
  assert.deepEqual(advance, { capital: 20000, revenue: 0 });
  assert.equal(base.capital + advance.capital, 100000);
});

test("paid advances are omitted from the due matrix while unpaid advances remain eligible", () => {
  const unpaid = order();
  const paid = order({
    advancePaymentDetail: {
      ...order().advancePaymentDetail,
      paymentDate: "2026-08-03",
    },
  });

  assert.deepEqual(getUnpaidAdvanceForecastEntry(file, unpaid), {
    date: "2026-08-01",
    monthKey: "2026-08",
    capital: 20000,
    revenue: 0,
    amount: 20000,
  });
  assert.equal(getUnpaidAdvanceForecastEntry(file, paid), undefined);
});

test("common-payment staged matrix uses the latest material receipt plus its offset", () => {
  const inspectionFile = { fileType: "Goods & Services", ir: "Yes" };
  const so = {
    stageDelivery: "Yes",
    stagePayment: "No",
    materialReceiptDate: "",
    stageDeliveries: [
      { materialReceiptDate: "2026-07-25" },
      { materialReceiptDate: "2026-08-15" },
    ],
  };

  assert.equal(getCommonStageReceiptExpectedPaymentDate(inspectionFile, so, 20), "2026-09-04");
  assert.equal(
    getCommonStageReceiptExpectedPaymentDate(
      inspectionFile,
      { ...so, materialReceiptDate: "2026-08-10" },
      20,
    ),
    undefined,
  );
});
