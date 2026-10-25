import { ChevronDown, Info, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelperContent } from "@/components/helper-content";
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SearchableDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  onSearchChange?: (query: string) => void;
  options: string[];
  optionItems?: Array<{
    value: string;
    label: string;
    searchTerms?: string[];
    helpText?: string[];
  }>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  deferChangeUntilSelect?: boolean;
  typeAheadOnly?: boolean;
  allowCustomValue?: boolean;
  clearValue?: string;
  clearLabel?: string;
  showClearOption?: boolean;
  preserveOptionOrder?: boolean;
  onEnter?: () => void;
  optionHelpClassName?: string;
};

export function SearchableDropdown({
  value,
  onChange,
  onSearchChange,
  options,
  optionItems,
  placeholder,
  disabled = false,
  className,
  "data-testid": testId,
  inputRef,
  autoFocus = false,
  deferChangeUntilSelect = false,
  typeAheadOnly = false,
  allowCustomValue = true,
  clearValue,
  clearLabel = "Clear selection",
  showClearOption = false,
  preserveOptionOrder = false,
  onEnter,
  optionHelpClassName = "w-[min(56rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]",
}: SearchableDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);

  const allOptions = useMemo(() => {
    const compareOptions = (left: string, right: string) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    const uniqueOptions = new Map<
      string,
      { value: string; label: string; searchTerms?: string[]; helpText?: string[] }
    >();
    for (const option of optionItems ?? options.map((item) => ({ value: item, label: item }))) {
      if (option.value && !uniqueOptions.has(option.value)) uniqueOptions.set(option.value, option);
    }
    const result = Array.from(uniqueOptions.values());
    return preserveOptionOrder
      ? result
      : result.sort((left, right) => compareOptions(left.label, right.label));
  }, [options, optionItems, preserveOptionOrder]);
  const visibleOptions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery
      ? allOptions.filter(
          (option) =>
            option.label.toLowerCase().includes(trimmedQuery) ||
            option.searchTerms?.some((term) => term.trim().toLowerCase().includes(trimmedQuery)),
        )
      : allOptions;
  }, [allOptions, query]);
  const selectedLabel = allOptions.find((option) => option.value === value)?.label ?? value;
  const resolvedClearValue =
    clearValue ??
    allOptions.find((option) => option.value === "all" || option.value === "__all__")?.value ??
    "";

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    setActiveOptionIndex(-1);
  }, [open, query, visibleOptions.length]);

  function setInputRef(element: HTMLInputElement | null) {
    internalInputRef.current = element;
    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef && "current" in inputRef) {
      (inputRef as { current: HTMLInputElement | null }).current = element;
    }
  }

  function openFullList() {
    if (disabled) return;
    setQuery("");
    onSearchChange?.("");
    setActiveOptionIndex(-1);
    setOpen(true);
  }

  function handleInputFocus(event: FocusEvent<HTMLInputElement>) {
    if (!typeAheadOnly) openFullList();
    event.currentTarget.select();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);
    setActiveOptionIndex(-1);
    onSearchChange?.(next);
    setEditing(true);
    setOpen(typeAheadOnly ? Boolean(next.trim()) : true);
    if (!deferChangeUntilSelect) onChange(next);
  }

  function handleInputBlur() {
    if (deferChangeUntilSelect && (typeAheadOnly ? editing : Boolean(query.trim()))) {
      const next = query.trim();
      const exactOption = allOptions.find(
        (option) => option.label.trim().toLowerCase() === next.toLowerCase(),
      );
      if (!next) onChange("");
      else if (allowCustomValue) onChange(exactOption?.value ?? next);
      else if (exactOption) onChange(exactOption.value);
    }
    setQuery("");
    onSearchChange?.("");
    setEditing(false);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && onEnter && (!open || activeOptionIndex < 0)) {
      event.preventDefault();
      onEnter();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        if (typeAheadOnly) setOpen(Boolean(query.trim()));
        else openFullList();
        setActiveOptionIndex(0);
      } else if (visibleOptions.length) {
        setActiveOptionIndex((current) => Math.min(current + 1, visibleOptions.length - 1));
      }
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open && visibleOptions.length) {
        setActiveOptionIndex((current) => Math.max(current - 1, 0));
      }
    }
    if (event.key === "Enter" && open && visibleOptions.length) {
      event.preventDefault();
      selectOption(
        visibleOptions[Math.max(0, Math.min(activeOptionIndex, visibleOptions.length - 1))],
      );
      return;
    }
    if (event.key === "Enter" && deferChangeUntilSelect) {
      if (typeAheadOnly && !editing) return;
      event.preventDefault();
      if (visibleOptions.length && (!typeAheadOnly || query.trim()))
        selectOption(visibleOptions[0]);
      else if (typeAheadOnly || query.trim()) {
        const next = query.trim();
        if (!next || allowCustomValue) onChange(next);
        setQuery("");
        onSearchChange?.("");
        setEditing(false);
        setOpen(false);
      }
    }
    if (event.key === "Escape") {
      setQuery("");
      onSearchChange?.("");
      setEditing(false);
      setOpen(false);
    }
  }

  function selectOption(option: { value: string; label: string }) {
    setQuery("");
    onSearchChange?.("");
    setEditing(false);
    setOpen(false);
    onChange(option.value);
    internalInputRef.current?.focus();
  }

  function clearSelection() {
    onChange(resolvedClearValue);
    setQuery("");
    onSearchChange?.("");
    setEditing(false);
    setOpen(false);
    setActiveOptionIndex(-1);
  }

  const canClear = Boolean(query.trim() || (value.trim() && value !== resolvedClearValue));

  return (
    <div ref={rootRef} className="relative w-full min-w-48 max-w-md">
      <input
        ref={setInputRef}
        value={
          typeAheadOnly
            ? editing
              ? query
              : selectedLabel
            : deferChangeUntilSelect && open && query
              ? query
              : selectedLabel
        }
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        className={
          (className ?? "") +
          (typeAheadOnly
            ? canClear
              ? " block w-full pr-9"
              : " block w-full"
            : canClear
              ? " block w-full pr-16"
              : " block w-full pr-9")
        }
      />
      {!typeAheadOnly && (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setQuery("");
              onSearchChange?.("");
              setOpen(false);
              return;
            }
            openFullList();
            internalInputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
          aria-label={open ? "Hide options" : "Show options"}
        >
          <ChevronDown className="size-4" />
        </button>
      )}
      {canClear ? (
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSelection}
          className={`absolute top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 ${typeAheadOnly ? "right-1.5" : "right-9"}`}
          aria-label="Clear field"
          title="Clear field"
        >
          <X className="size-4" />
        </button>
      ) : null}
      {open && !disabled ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full min-w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          {!typeAheadOnly && showClearOption && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelection}
              className={
                "block min-h-8 w-full rounded px-2 py-1.5 text-left hover:bg-accent " +
                (value === resolvedClearValue ? "font-semibold text-primary" : "")
              }
              aria-label="Clear selection"
            >
              {clearLabel}
            </button>
          )}
          {visibleOptions.length ? (
            visibleOptions.map((option, index) =>
              option.helpText ? (
                <div
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOptionIndex(index)}
                  onClick={() => selectOption(option)}
                  className={
                    "flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent " +
                    (index === activeOptionIndex ? "bg-accent " : "") +
                    (option.value === value ? "font-semibold text-primary " : "")
                  }
                  role="option"
                  aria-selected={index === activeOptionIndex}
                >
                  <span>{option.label}</span>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`About ${option.label}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className={`${optionHelpClassName} max-h-[min(80dvh,var(--radix-popper-available-height,80dvh))] overflow-y-auto overscroll-contain touch-pan-y border border-border bg-background p-2 text-foreground shadow-lg leading-relaxed`}
                      >
                        <HelperContent lines={option.helpText} />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : (
                <button
                  key={option.value}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOptionIndex(index)}
                  onClick={() => selectOption(option)}
                  className={
                    "block w-full rounded px-2 py-1.5 text-left hover:bg-accent " +
                    (index === activeOptionIndex ? "bg-accent " : "") +
                    (option.value === value ? "font-semibold text-primary" : "")
                  }
                  role="option"
                  aria-selected={index === activeOptionIndex}
                >
                  {option.label}
                </button>
              ),
            )
          ) : (
            <div className="px-2 py-2 text-muted-foreground">
              {deferChangeUntilSelect && allowCustomValue
                ? "No match. Press Enter to keep this value."
                : "No matching option"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
