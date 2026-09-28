import { ChevronDown } from "lucide-react";
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
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  inputRef?: Ref<HTMLInputElement>;
  deferChangeUntilSelect?: boolean;
  typeAheadOnly?: boolean;
  allowCustomValue?: boolean;
  clearLabel?: string;
};

export function SearchableDropdown({
  value,
  onChange,
  onSearchChange,
  options,
  placeholder,
  disabled = false,
  className,
  "data-testid": testId,
  inputRef,
  deferChangeUntilSelect = false,
  typeAheadOnly = false,
  allowCustomValue = true,
  clearLabel = "Clear selection",
}: SearchableDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);

  const visibleOptions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    const compareOptions = (left: string, right: string) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    const uniqueOptions = Array.from(new Set(options.filter(Boolean))).sort(compareOptions);
    if (!trimmedQuery) return uniqueOptions;
    return uniqueOptions
      .filter((option) => option.toLowerCase().includes(trimmedQuery))
      .sort((left, right) => {
        const leftExact = left.toLowerCase() === trimmedQuery;
        const rightExact = right.toLowerCase() === trimmedQuery;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftStartsWith = left.toLowerCase().startsWith(trimmedQuery);
        const rightStartsWith = right.toLowerCase().startsWith(trimmedQuery);
        return leftStartsWith === rightStartsWith
          ? compareOptions(left, right)
          : leftStartsWith
            ? -1
            : 1;
      });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [open]);

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
    setOpen(true);
  }

  function handleInputFocus(event: FocusEvent<HTMLInputElement>) {
    if (!typeAheadOnly) openFullList();
    event.currentTarget.select();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);
    onSearchChange?.(next);
    setEditing(true);
    setOpen(typeAheadOnly ? Boolean(next.trim()) : true);
    if (!deferChangeUntilSelect) onChange(next);
  }

  function handleInputBlur() {
    if (deferChangeUntilSelect && (typeAheadOnly ? editing : Boolean(query.trim()))) {
      const next = query.trim();
      if (!next || allowCustomValue || options.includes(next)) onChange(next);
    }
    setQuery("");
    onSearchChange?.("");
    setEditing(false);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (typeAheadOnly) setOpen(Boolean(query.trim()));
      else openFullList();
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

  function selectOption(option: string) {
    onChange(option);
    setQuery("");
    onSearchChange?.("");
    setEditing(false);
    setOpen(false);
    internalInputRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <input
        ref={setInputRef}
        value={
          typeAheadOnly
            ? editing
              ? query
              : value
            : deferChangeUntilSelect && open && query
              ? query
              : value
        }
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        className={(className ?? "") + (typeAheadOnly ? " block w-full" : " block w-full pr-9")}
      />
      {!typeAheadOnly && (
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            if (open) {
              setQuery("");
              setOpen(false);
              return;
            }
            openFullList();
            internalInputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          aria-label="Show options"
        >
          <ChevronDown className="size-4" />
        </button>
      )}
      {open && !disabled ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          {!typeAheadOnly && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption("")}
              className={
                "block min-h-8 w-full rounded px-2 py-1.5 text-left hover:bg-accent " +
                (value === "" ? "font-semibold text-primary" : "")
              }
              aria-label="Clear selection"
            >
              {clearLabel}
            </button>
          )}
          {visibleOptions.length ? (
            visibleOptions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className={
                  "block w-full rounded px-2 py-1.5 text-left hover:bg-accent " +
                  (option === value ? "font-semibold text-primary" : "")
                }
              >
                {option}
              </button>
            ))
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
