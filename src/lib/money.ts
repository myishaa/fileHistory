import type { FileRecord } from "@/lib/files-store";

export function parseAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeAmountInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [integerPart = "", ...decimalParts] = digitsAndDots.split(".");
  return decimalParts.length ? `${integerPart}.${decimalParts.join("")}` : integerPart;
}

export function formatAmountInput(value: string) {
  if (!value) return value;
  const [integerPart, ...decimalParts] = normalizeAmountInput(value).split(".");
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);
  const formattedInteger = beforeThousands
    ? [beforeThousands.slice(0, -2), beforeThousands.slice(-2), lastThree]
        .filter(Boolean)
        .join(",")
    : integerPart;
  return decimalParts.length ? `${formattedInteger}.${decimalParts.join("")}` : formattedInteger;
}

export function handleFormattedAmountInput(input: HTMLInputElement, onValue: (value: string) => void) {
  const cursor = input.selectionStart ?? input.value.length;
  const charactersBeforeCursor = normalizeAmountInput(input.value.slice(0, cursor)).length;
  const normalizedValue = normalizeAmountInput(input.value);
  const formattedValue = formatAmountInput(normalizedValue);
  let nextCursor = 0;
  let charactersSeen = 0;
  while (nextCursor < formattedValue.length && charactersSeen < charactersBeforeCursor) {
    if (/[\d.]/.test(formattedValue[nextCursor])) charactersSeen += 1;
    nextCursor += 1;
  }
  onValue(normalizedValue);
  requestAnimationFrame(() => input.setSelectionRange(nextCursor, nextCursor));
}

export function hasAmount(value: string | undefined) {
  return parseAmount(value) !== undefined;
}

export function getInrAmount(value: string | number | undefined, file: FileRecord) {
  const amount = parseAmount(value);
  if (amount === undefined) return undefined;

  const currency = (file.currency ?? "INR").trim().toUpperCase();
  if (!currency || currency === "INR") return amount;

  const exchangeRate = parseAmount(file.exchangeRate);
  if (exchangeRate === undefined || exchangeRate <= 0) return undefined;

  return amount * exchangeRate;
}

export function formatThousandsAndLakhs(value: number, maximumFractionDigits = 2) {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);
  const fixedValue = Number.isInteger(absoluteValue)
    ? String(absoluteValue)
    : absoluteValue.toFixed(maximumFractionDigits).replace(/\.?0+$/, "");
  const [integerPart, decimalPart] = fixedValue.split(".");
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) {
    return `${sign}${integerPart}${decimalPart ? `.${decimalPart}` : ""}`;
  }

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  const formattedInteger = [lakhPart, lastTwoBeforeThousands, lastThree]
    .filter(Boolean)
    .join(",");
  return `${sign}${formattedInteger}${decimalPart ? `.${decimalPart}` : ""}`;
}
