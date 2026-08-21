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
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  inputRef?: Ref<HTMLInputElement>;
};

export function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className,
  "data-testid": testId,
  inputRef,
}: SearchableDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleOptions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    const uniqueOptions = Array.from(new Set(options.filter(Boolean)));
    if (!trimmedQuery) return uniqueOptions;
    return uniqueOptions.filter((option) => option.toLowerCase().includes(trimmedQuery));
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
    openFullList();
    event.currentTarget.select();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);
    setOpen(true);
    onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openFullList();
    }
    if (event.key === "Escape") setOpen(false);
  }

  function selectOption(option: string) {
    onChange(option);
    setQuery("");
    setOpen(false);
    internalInputRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={setInputRef}
        value={value}
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        className={(className ?? "") + " pr-9"}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onMouseDown={(event) => {
          event.preventDefault();
          if (open) {
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
      {open && !disabled ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
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
            <div className="px-2 py-2 text-muted-foreground">No options</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
