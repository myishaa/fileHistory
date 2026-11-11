import {
  forwardRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type ClearableProps = {
  /** Called only when the user explicitly presses the clear button. */
  onClear?: () => void;
};

function hasInputValue(value: unknown) {
  // Do not use Boolean(value): numeric 0 is a legitimate value and must remain visible.
  return value !== undefined && value !== null && String(value).length > 0;
}

function containerClassName(className: string | undefined) {
  const classes = className ?? "";
  // Keep the clear button anchored to the rendered control. A full-width
  // wrapper is only correct when the input is also full width; for inputs with
  // a max/fixed width, it would place the button at the far edge of the form.
  const maxWidth = classes.match(/\bmax-w-[^\s]+/)?.[0];
  if (/\bw-full\b/.test(classes)) return ["w-full", maxWidth].filter(Boolean).join(" ");
  if (/\bflex-1\b/.test(classes)) return "flex-1";
  if (classes.split(/\s+/).some((token) => /^w-/.test(token))) return "w-fit";
  if (maxWidth) return ["w-full", maxWidth].join(" ");
  return "w-fit";
}

export const ClearableInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & ClearableProps
>(function ClearableInput({ className, onClear, value, disabled, readOnly, ...props }, ref) {
  const showClear = Boolean(props.onChange || onClear) && hasInputValue(value) && !disabled && !readOnly;
  const clear = () => {
    if (onClear) {
      onClear();
      return;
    }
    props.onChange?.({
      target: { value: "" },
      currentTarget: { value: "" },
    } as ChangeEvent<HTMLInputElement>);
  };

  return (
    <span className={cn("relative inline-flex min-w-0 max-w-full align-top", containerClassName(className))}>
      <input
        {...props}
        ref={ref}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(className, showClear && "pr-9")}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Clear field"
          title="Clear field"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          className="absolute right-2 top-1/2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md bg-background text-foreground opacity-80 transition hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </span>
  );
});

ClearableInput.displayName = "ClearableInput";

export const ClearableTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & ClearableProps
>(function ClearableTextarea({ className, onClear, value, disabled, readOnly, ...props }, ref) {
  const showClear = Boolean(props.onChange || onClear) && hasInputValue(value) && !disabled && !readOnly;
  const clear = () => {
    if (onClear) {
      onClear();
      return;
    }
    props.onChange?.({
      target: { value: "" },
      currentTarget: { value: "" },
    } as ChangeEvent<HTMLTextAreaElement>);
  };

  return (
    <span className={cn("relative inline-flex min-w-0 max-w-full align-top", containerClassName(className))}>
      <textarea
        {...props}
        ref={ref}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(className, showClear && "pr-9")}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Clear field"
          title="Clear field"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md bg-background text-foreground opacity-80 transition hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </span>
  );
});

ClearableTextarea.displayName = "ClearableTextarea";
