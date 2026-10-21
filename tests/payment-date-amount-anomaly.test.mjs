import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentDateAmountAnomalies } from "../backend/src/utils/payment-date-amount-anomalies.ts";

test("a payment date without an actual amount is anomalous", () => {
  assert.deepEqual(getPaymentDateAmountAnomalies("2026-06-10", "", ""), [
    "payment_date_without_amount",
  ]);
});

test("an actual amount without a payment date is anomalous", () => {
  assert.deepEqual(getPaymentDateAmountAnomalies("", "1,250", ""), [
    "amount_without_payment_date",
  ]);
});

test("zero actual amount with a payment date is anomalous", () => {
  assert.deepEqual(getPaymentDateAmountAnomalies("2026-06-10", "0", "0"), [
    "zero_amount_with_payment_date",
  ]);
});

test("a recorded zero amount without a payment date is anomalous", () => {
  assert.deepEqual(getPaymentDateAmountAnomalies("", "0", ""), [
    "amount_without_payment_date",
  ]);
});

test("a dated positive actual payment amount is consistent", () => {
  assert.deepEqual(getPaymentDateAmountAnomalies("2026-06-10", "1,250", ""), []);
});
