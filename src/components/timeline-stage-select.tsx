import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TimelineStageSelectOption = {
  value: string;
  label: string;
  status?: string;
};

export function TimelineStageSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
}: {
  value: string;
  options: TimelineStageSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-full max-w-md bg-background sm:w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => {
          const tone = getTimelineStageSelectTone(option.status);
          return (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex min-w-0 items-center gap-2">
                {option.status ? (
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${tone.dot}`}
                  />
                ) : null}
                <span className="truncate">{option.label}</span>
                {option.status ? (
                  <span className={`ml-2 shrink-0 text-xs font-medium ${tone.text}`}>
                    · {option.status}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function getTimelineStageSelectTone(status?: string) {
  if (status === "Complete") return { dot: "bg-success", text: "text-success" };
  if (status === "Upcoming") return { dot: "bg-destructive", text: "text-destructive" };
  if (status === "Due today" || status === "Overdue") {
    return { dot: "bg-warning", text: "text-warning" };
  }
  return { dot: "bg-muted-foreground/50", text: "text-muted-foreground" };
}
