const helperSectionRules = [
  { title: "Purpose", match: /^\s*purpose:/i },
  { title: "Add or activate", match: /^\s*add or activate:/i },
  { title: "Reorder", match: /^\s*reorder:/i },
  { title: "Remove", match: /^\s*remove:/i },
  {
    title: "Caution",
    match: /^\s*(caution|warning)\b/i,
  },
  {
    title: "Example",
    match: /^\s*(example|e\.g\.)\b/i,
  },
  {
    title: "Filters",
    match:
      /\b(global filter|file initiation year|subfilter|date range|division filter|file type filter|current filters|filter(?:s|ed|ing)? apply|selected fy)\b/i,
  },
  {
    title: "Included and excluded",
    match:
      /\b(include|included|includes|exclude|excluded|excludes|cancelled|canceled|shortclosed|closed files|active files)\b/i,
  },
  {
    title: "What is counted",
    match:
      /\b(count|counts|counted|file count|unique files|rows?|bills?|stages?|average|median|minimum|maximum|value|amount|basis|samples?|calculated|sums?)\b/i,
  },
  {
    title: "Clicking a result",
    match: /\b(click|clicker|opens?|open search|drill.?down|export)\b/i,
  },
];

function groupHelperLines(lines: string[]) {
  const groups = new Map<string, string[]>();
  lines
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const section = helperSectionRules.find((rule) => rule.match.test(line))?.title ?? "Details";
      groups.set(section, [...(groups.get(section) ?? []), line]);
    });
  const sectionOrder = [
    "Purpose",
    "Add or activate",
    "Reorder",
    "Remove",
    "Filters",
    "Included and excluded",
    "What is counted",
    "Clicking a result",
    "Details",
    "Caution",
    "Example",
  ];
  return Array.from(groups, ([title, items]) => ({ title, items })).sort(
    (left, right) => sectionOrder.indexOf(left.title) - sectionOrder.indexOf(right.title),
  );
}

export function HelperContent({ lines }: { lines: string[] }) {
  const groups = groupHelperLines(lines);
  return (
    <div className="max-h-[min(72vh,38rem)] overflow-y-auto pr-1 text-[13px] leading-relaxed">
      <div className="flex flex-col gap-3">
        {groups.map(({ title, items }) => (
          <section
            key={title}
            className={
              "min-w-0 rounded-md border p-3 " +
              (title === "Caution"
                ? "border-destructive/25 bg-destructive/5"
                : title === "Filters"
                ? "border-primary/30 bg-primary/10"
                : "border-primary/15 bg-primary/5")
            }
          >
            <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
            <ul className="list-disc space-y-1 pl-4 text-popover-foreground">
              {items.map((item, index) => (
                <li key={`${title}-${index}`}>
                  {item.replace(/^(Purpose|Add or activate|Reorder|Remove):\s*/i, "")}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="rounded-md border border-border bg-secondary/25 p-3 text-foreground">
          No additional details.
        </p>
      ) : null}
    </div>
  );
}
