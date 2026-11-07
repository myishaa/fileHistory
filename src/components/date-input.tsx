import {
  forwardRef,
  type InputHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, X } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

/** Shared limits for every calendar-backed date field in the application. */
export const DATE_PICKER_START_YEAR = 2020;
export const DATE_PICKER_END_YEAR = 2100;
const DATE_PICKER_START_MONTH = new Date(DATE_PICKER_START_YEAR, 0, 1);
const DATE_PICKER_END_MONTH = new Date(DATE_PICKER_END_YEAR, 11, 31);

type DateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  calendar?: boolean;
  widthClass?: string;
};

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    value,
    onChange,
    onBlur,
    className,
    placeholder = "DD-MM-YYYY",
    inputMode = "numeric",
    calendar = true,
    widthClass,
    ...props
  },
  ref,
) {
  const [displayValue, setDisplayValue] = useState(formatIsoDateForDisplay(value));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    clampCalendarMonth(isoToLocalDate(value) ?? new Date()),
  );
  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarPopupRef = useRef<HTMLDivElement>(null);
  const [calendarPosition, setCalendarPosition] = useState<{
    left: number;
    top: number;
    openAbove: boolean;
  } | null>(null);

  useEffect(() => {
    setDisplayValue(formatIsoDateForDisplay(value));
    if (!calendarOpen) {
      const selectedDate = isoToLocalDate(value);
      if (selectedDate) setCalendarMonth(clampCalendarMonth(selectedDate));
    }
  }, [calendarOpen, value]);

  useEffect(() => {
    if (!calendar || !calendarOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!calendarRef.current?.contains(target) && !calendarPopupRef.current?.contains(target)) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendar, calendarOpen]);

  useLayoutEffect(() => {
    if (!calendar || !calendarOpen) return;

    const updateCalendarPosition = () => {
      const rect = calendarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popupWidth = Math.min(320, window.innerWidth - 16);
      const popupHeight = 360;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const openAbove = spaceBelow < popupHeight && rect.top > spaceBelow;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
      setCalendarPosition({
        left,
        top: openAbove ? Math.max(8, rect.top - 8) : rect.bottom + 8,
        openAbove,
      });
    };

    updateCalendarPosition();
    window.addEventListener("resize", updateCalendarPosition);
    window.addEventListener("scroll", updateCalendarPosition, true);
    return () => {
      window.removeEventListener("resize", updateCalendarPosition);
      window.removeEventListener("scroll", updateCalendarPosition, true);
    };
  }, [calendar, calendarOpen]);

  const input = (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode={inputMode}
      className={cn(
        "text-foreground",
        className,
        calendar ? "pr-14" : undefined,
        widthClass ?? "w-[160px] min-w-[160px]",
      )}
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

  if (!calendar) return input;

  const selectedDate = isoToLocalDate(value);
  const disabled = Boolean(props.disabled);

  return (
    <div
      ref={calendarRef}
      className={cn(
        "relative inline-block",
        widthClass ?? "w-[160px] min-w-[160px] max-w-[160px]",
      )}
    >
      <div className="relative">
        {input}
        {displayValue || value ? (
          <button
            type="button"
            aria-label="Clear date"
            title="Clear date"
            disabled={disabled}
            onClick={() => {
              setDisplayValue("");
              setCalendarOpen(false);
              onChange("");
            }}
            className="absolute right-9 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Open calendar"
          title="Open calendar"
          disabled={disabled}
          onClick={() => {
            setCalendarMonth(clampCalendarMonth(selectedDate ?? new Date()));
            setCalendarOpen((open) => !open);
          }}
          className={cn(
            "absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <CalendarDays className="size-3.5" />
        </button>
      </div>
      {calendarOpen && calendarPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={calendarPopupRef}
              className={cn(
                "fixed z-[1000] rounded-md border border-border bg-popover text-popover-foreground shadow-lg",
                calendarRef.current?.closest(".dark") ? "dark" : "",
              )}
              style={{
                left: calendarPosition.left,
                top: calendarPosition.top,
                transform: calendarPosition.openAbove ? "translateY(-100%)" : undefined,
              }}
            >
              <Calendar
                mode="single"
                captionLayout="dropdown"
                fromYear={DATE_PICKER_START_YEAR}
                toYear={DATE_PICKER_END_YEAR}
                startMonth={DATE_PICKER_START_MONTH}
                endMonth={DATE_PICKER_END_MONTH}
                selected={selectedDate ?? undefined}
                disabled={{ before: DATE_PICKER_START_MONTH, after: DATE_PICKER_END_MONTH }}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                onSelect={(date) => {
                  if (!date) return;
                  const iso = formatLocalDate(date);
                  setDisplayValue(formatIsoDateForDisplay(iso));
                  onChange(iso);
                  setCalendarOpen(false);
                }}
                initialFocus
              />
            </div>,
            document.body,
          )
        : null}
    </div>
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

function isoToLocalDate(value: string | undefined) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : undefined;
}

function formatLocalDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampCalendarMonth(date: Date) {
  if (date < DATE_PICKER_START_MONTH) return DATE_PICKER_START_MONTH;
  if (date > DATE_PICKER_END_MONTH) return DATE_PICKER_END_MONTH;
  return date;
}
