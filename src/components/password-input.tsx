import { forwardRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, X } from "lucide-react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onClear?: () => void;
};

/** A password field with an explicit, accessible show/hide control. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = "", disabled, onClear, value, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const label = visible ? "Hide password" : "Show password";
    const showClear =
      Boolean(props.onChange || onClear) &&
      value !== undefined &&
      value !== null &&
      String(value).length > 0 &&
      !disabled;
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
      <span className="relative block min-w-0">
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          disabled={disabled}
          value={value}
          className={`${className} ${showClear ? "pr-16" : "pr-10"}`}
        />
        {showClear ? (
          <button
            type="button"
            aria-label="Clear field"
            title="Clear field"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className="absolute right-9 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={visible}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
