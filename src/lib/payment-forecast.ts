import type { FileRecord, SupplyOrderDetail } from "@/lib/files-store";
import { addDays, format, parseISO } from "date-fns";
import { getParentStagePaymentDate, isParentStagePaymentOrder } from "@/lib/effective-deliveries";
import { isDeliveryInspectionApplicableByGroup } from "@/lib/file-type-groups";
import { getInrAmount } from "@/lib/money";

export type PaymentForecastAmounts = { capital: number; revenue: number };

export type UnpaidAdvanceForecastEntry = PaymentForecastAmounts & {
  date: string;
  monthKey: string;
  amount: number;
};

export function getCommonStageReceiptExpectedPaymentDate(
  file: FileRecord,
  order: SupplyOrderDetail,
  paymentOffsetDays: number,
): string | undefined {
  if (
    !isDeliveryInspectionApplicableByGroup(file) ||
    !isParentStagePaymentOrder(order) ||
    order.materialReceiptDate?.trim()
  ) {
    return undefined;
  }

  const latestStageReceipt = getParentStagePaymentDate(order, "materialReceiptDate");
  if (!latestStageReceipt) return undefined;
  return format(addDays(parseISO(latestStageReceipt), paymentOffsetDays), "yyyy-MM-dd");
}

export function getAdvanceForecastAmounts(
  file: FileRecord,
  order: SupplyOrderDetail,
): PaymentForecastAmounts {
  return {
    capital:
      getInrAmount(order.advancePaymentDetail?.stageAmountCapital, file) ??
      getInrAmount(order.advancePaymentDetail?.actualPaymentCapital, file) ??
      0,
    revenue:
      getInrAmount(order.advancePaymentDetail?.stageAmountRevenue, file) ??
      getInrAmount(order.advancePaymentDetail?.actualPaymentRevenue, file) ??
      0,
  };
}

export function getUnpaidAdvanceForecastEntry(
  file: FileRecord,
  order: SupplyOrderDetail,
): UnpaidAdvanceForecastEntry | undefined {
  const advance = order.advancePaymentDetail;
  const date = advance?.expectedPaymentDate?.trim();
  if (!date || advance?.paymentDate?.trim()) return undefined;

  const { capital, revenue } = getAdvanceForecastAmounts(file, order);
  const amount = Math.round(capital + revenue);
  if (amount <= 0) return undefined;

  return { date, monthKey: date.slice(0, 7), capital, revenue, amount };
}

export function getBaseOrderForecastAmounts(
  file: FileRecord,
  order: SupplyOrderDetail,
): PaymentForecastAmounts {
  const hasCapitalBillAmount = Boolean(order.billAmountCapital?.trim());
  const hasRevenueBillAmount = Boolean(order.billAmountRevenue?.trim());
  const planned = {
    capital:
      getInrAmount(hasCapitalBillAmount ? order.billAmountCapital : order.soValueCapital, file) ??
      0,
    revenue:
      getInrAmount(hasRevenueBillAmount ? order.billAmountRevenue : order.soValueRevenue, file) ??
      0,
  };
  if (order.stageDeliveryLabel || order.advancePayment?.trim().toLowerCase() !== "yes") {
    return planned;
  }

  const advance = getAdvanceForecastAmounts(file, order);
  return {
    capital: hasCapitalBillAmount
      ? planned.capital
      : Math.max(0, planned.capital - advance.capital),
    revenue: hasRevenueBillAmount
      ? planned.revenue
      : Math.max(0, planned.revenue - advance.revenue),
  };
}
