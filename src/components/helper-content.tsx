const helperSectionRules = [
  { title: "Details", match: /^\s*(?:purpose|details):/i },
  { title: "Add or activate", match: /^\s*add or activate:/i },
  { title: "Reorder", match: /^\s*reorder:/i },
  { title: "Remove", match: /^\s*remove:/i },
  {
    title: "Caution",
    match: /^\s*(caution|warning)\b/i,
  },
  {
    title: "Examples",
    match: /^\s*(?:for\s+)?(?:example|e\.g\.)(?:\s|:|,|$)/i,
  },
  {
    title: "Examples",
    match: /^\s*example-[123](?:\s|:|,|$)/i,
  },
  {
    title: "Filter",
    match:
      /\b(global filter|file initiation year|subfilter|date range|division filter|file type filter|current filters|filter(?:s|ed|ing)? apply|selected fy)\b/i,
  },
  {
    title: "Included and Excluded",
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

const defaultSectionOrder = [
  "What is counted",
  "Details",
  "Included and Excluded",
  "Filter",
  "Add or activate",
  "Reorder",
  "Remove",
  "Clicking a result",
  "Caution",
  "Examples",
];

function groupHelperLines(lines: string[], sectionOrder = defaultSectionOrder) {
  const groups = new Map<string, string[]>();
  lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const example = line.match(/^(.*\S)\s+(?:for\s+)?example(?::|,)\s*(.+)$/i);
      return example ? [example[1], `Example: ${example[2]}`] : [line];
    })
    .forEach((line) => {
      const section = helperSectionRules.find((rule) => rule.match.test(line))?.title ?? "Details";
      groups.set(section, [...(groups.get(section) ?? []), line]);
    });
  const orderIndex = new Map(sectionOrder.map((title, index) => [title, index]));
  return Array.from(groups, ([title, items]) => ({ title, items })).sort(
    (left, right) =>
      (orderIndex.get(left.title) ?? sectionOrder.length) -
      (orderIndex.get(right.title) ?? sectionOrder.length),
  );
}

export function HelperContent({
  lines,
  sectionOrder,
}: {
  lines: string[];
  sectionOrder?: string[];
}) {
  const groups = groupHelperLines(lines, sectionOrder);
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
                : title === "Filter"
                  ? "border-primary/30 bg-primary/10"
                  : "border-primary/15 bg-primary/5")
            }
          >
            <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
            {title === "Examples" ? (
              <div className="overflow-x-auto rounded-sm border border-primary/20 bg-background/70">
                <table className="w-full min-w-[28rem] border-collapse text-left text-xs text-popover-foreground">
                  <thead className="bg-primary/10">
                    <tr>
                      <th scope="col" className="w-12 border-b border-r border-primary/15 px-2 py-2 font-semibold">#</th>
                      <th scope="col" className="border-b border-primary/15 px-3 py-2 font-semibold">Example and inference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={`example-${index}`} className={index % 2 === 0 ? "bg-primary/5" : "bg-muted/45"}>
                        <th scope="row" className="border-b border-r border-primary/15 px-2 py-2 align-top font-medium text-muted-foreground">{index + 1}</th>
                        <td className="border-b border-primary/15 px-3 py-2 align-top">
                          {item.replace(/^(?:For\s+)?Example(?::|,)\s*|^Example-[123](?::|,)\s*|^e\.g\.\s*/i, "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-popover-foreground">
                {items.map((item, index) => (
                  <li
                    key={`${title}-${index}`}
                    className={`rounded-sm border-l-2 border-primary/25 px-2 py-1 ${index % 2 === 0 ? "bg-primary/5" : "bg-muted/45"}`}
                  >
                    {item.replace(
                      /^(?:Purpose|Details|Included and Excluded|Add or activate|Reorder|Remove):\s*/i,
                      "",
                    )}
                  </li>
                ))}
              </ul>
            )}
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
