
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyChartAsPng } from "@/lib/copy-chart";

export type ResultView = "table" | "bar" | "line" | "pie";

export function TableChartToggle({
  value,
  onChange,
  label = "Result view",
  views = ["table", "bar"],
}: {
  value: ResultView;
  onChange: (value: ResultView) => void;
  label?: string;
  views?: ResultView[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-border bg-background p-0.5">
      {views.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={`rounded px-2.5 text-xs font-medium capitalize ${value === view ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {view}
        </button>
      ))}
    </div>
  );
}

export function ChartCopyButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "downloaded" | "error">("idle");

  const copyChart = async () => {
    if (!buttonRef.current) return;
    try {
      setCopyState(await copyChartAsPng(buttonRef.current));
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2200);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={copyChart}
      data-chart-copy-exclude
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/95 px-2 text-xs font-medium text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
      title={copyState === "downloaded" ? "Clipboard access was blocked; the chart was downloaded instead" : copyState === "error" ? "Could not copy or download this chart" : "Copy this chart as an image"}
      aria-label={copyState === "copied" ? "Chart copied" : copyState === "downloaded" ? "Chart downloaded" : "Copy this chart"}
      aria-live="polite"
    >
      {copyState === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copyState === "copied" ? "Copied" : copyState === "downloaded" ? "Downloaded" : copyState === "error" ? "Copy failed" : "Copy chart"}
    </button>
  );
}
