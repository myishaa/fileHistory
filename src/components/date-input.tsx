import { forwardRef, type InputHTMLAttributes, useEffect, useState } from "react";

type DateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
};

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, onBlur, placeholder = "DD-MM-YYYY", inputMode = "numeric", ...props },
  ref,
) {
  const [displayValue, setDisplayValue] = useState(formatIsoDateForDisplay(value));

  useEffect(() => {
    setDisplayValue(formatIsoDateForDisplay(value));
  }, [value]);

  return (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode={inputMode}
      value={displayValue}
      placeholder={placeholder}
      onChange={(event) => {
        const rawValue = event.target.value.trim();
        const pastedIso = parseIsoDate(rawValue);
        if (pastedIso) {
          setDisplayValue(formatIsoDateForDisplay(pastedIso));
          onChange(pastedIso);
          return;
        }
        const nextDisplay = formatDateDisplayInput(rawValue);
        setDisplayValue(nextDisplay);
        if (!nextDisplay) {
          onChange("");
          return;
        }
        const iso = parseDisplayDateToIso(nextDisplay);
        if (iso) onChange(iso);
      }}
      onBlur={(event) => {
        const iso = parseDisplayDateToIso(displayValue);
        setDisplayValue(iso ? formatIsoDateForDisplay(iso) : formatIsoDateForDisplay(value));
        onBlur?.(event);
      }}
    />
  );
});

export function formatIsoDateForDisplay(value: string | undefined) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatDateDisplayInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

function parseDisplayDateToIso(value: string) {
  const text = value.trim();
  const displayMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (displayMatch) return validIsoDate(displayMatch[3], displayMatch[2], displayMatch[1]);
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return validIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  return undefined;
}

function parseIsoDate(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return undefined;
  return validIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);
}

function validIsoDate(year: string, month: string, day: string) {
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const actualYear = String(date.getFullYear()).padStart(4, "0");
  const actualMonth = String(date.getMonth() + 1).padStart(2, "0");
  const actualDay = String(date.getDate()).padStart(2, "0");
  if (actualYear !== year || actualMonth !== month || actualDay !== day) return undefined;
  return iso;
}
