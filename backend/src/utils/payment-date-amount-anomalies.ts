export type PaymentDateAmountAnomaly =
  | "payment_date_without_amount"
  | "zero_amount_with_payment_date"
  | "amount_without_payment_date";

export function getPaymentDateAmountAnomalies(
  paymentDate: string | undefined,
  actualCapital: string | undefined,
  actualRevenue: string | undefined,
): PaymentDateAmountAnomaly[] {
  const hasDate = Boolean(paymentDate?.trim());
  const hasCapital = Boolean(actualCapital?.trim());
  const hasRevenue = Boolean(actualRevenue?.trim());
  const hasAmount = hasCapital || hasRevenue;

  if (hasDate && !hasAmount) return ["payment_date_without_amount"];
  if (!hasDate && hasAmount) return ["amount_without_payment_date"];
  if (!hasDate) return [];

  const capital = parseAmount(actualCapital);
  const revenue = parseAmount(actualRevenue);
  return capital + revenue <= 0 ? ["zero_amount_with_payment_date"] : [];
}

function parseAmount(value: string | undefined) {
  if (!value?.trim()) return 0;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
