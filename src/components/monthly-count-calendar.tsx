import { X } from "lucide-react";

export type MonthlyCalendarDay = {
  date: string;
  metrics: Array<{
    label: string;
    value: number;
    color?: "blue" | "red" | "green";
    hideLabel?: boolean;
    onClick?: () => void;
  }>;
};

const metricColorClasses = {
  blue: "text-blue-600 dark:text-blue-400",
  red: "text-red-600 dark:text-red-400",
  green: "text-green-600 dark:text-green-400",
} as const;

export function MonthlyCountCalendar({
  monthKey,
  days,
  onClose,
  showClose = true,
}: {
  monthKey: string;
  days: MonthlyCalendarDay[];
  onClose: () => void;
  showClose?: boolean;
}) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return null;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const numberOfDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map(days.map((day) => [day.date, day]));
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <section
      className="rounded-md border border-border bg-card p-3"
      aria-label={`${monthLabel} daily counts`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{monthLabel}</h3>
        {showClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close monthly calendar"
            title="Close monthly calendar"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div key={weekday} className="py-1 font-medium">
            {weekday}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <div key={`blank-${index}`} aria-hidden="true" />
        ))}
        {Array.from({ length: numberOfDays }, (_, index) => {
          const dayNumber = index + 1;
          const date = `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
          const day = byDate.get(date);
          return (
            <div
              key={date}
              className="relative flex min-h-20 flex-col rounded-md border border-border/70 bg-background p-1.5 text-left"
            >
              <div className="text-xs font-medium text-foreground">{dayNumber}</div>
              {day?.metrics.length ? (
                <div className="flex flex-1 flex-col justify-center gap-0.5">
                  {day.metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className={`flex min-w-0 items-center gap-1 ${metric.hideLabel ? "justify-center" : "justify-between"}`}
                    >
                      {day.metrics.length > 1 && !metric.hideLabel ? (
                        <span className="min-w-0 truncate text-[10px] leading-3 text-muted-foreground">
                          {metric.label}
                        </span>
                      ) : null}
                      {metric.onClick ? (
                        <button
                          type="button"
                          onClick={metric.onClick}
                          className={`min-w-8 rounded-sm text-center text-sm font-semibold leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric.color ? metricColorClasses[metric.color] : "text-primary"}`}
                          aria-label={`${metric.value} ${metric.label} on ${date}`}
                          title={`Open ${metric.label.toLowerCase()} for ${date}`}
                        >
                          {metric.value}
                        </button>
                      ) : (
                        <span
                          className={`text-sm font-semibold leading-5 ${metric.color ? metricColorClasses[metric.color] : "text-foreground"}`}
                        >
                          {metric.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
