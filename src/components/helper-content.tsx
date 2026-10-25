import { useRef } from "react";
import { FileDown } from "lucide-react";
import { downloadBackendExport, type ExportTable } from "@/lib/export-download";

const helperSectionRules = [
  { title: "What it does", match: /^\s*purpose:/i },
  { title: "Additional details", match: /^\s*details:/i },
  { title: "Add or activate", match: /^\s*add or activate:/i },
  { title: "Reorder", match: /^\s*reorder:/i },
  { title: "Remove", match: /^\s*remove:/i },
  {
    title: "Caution",
    match: /^\s*(caution|warning)\b/i,
  },
  {
    title: "Examples",
    match: /^\s*(?:for\s+)?(?:example(?:\s+(?:table|row|context))?|e\.g\.)(?:\s|:|,|$)/i,
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
      /\b(count|counts|counted|file count|unique files|rows?|bills?|stages?|average|median|minimum|maximum|value|amount|basis|samples?|calculated|sums?|edit it when a different date is expected|manual date updation)\b/i,
  },
  {
    title: "Clicking a result",
    match: /\b(click|clicker|opens?|open search|drill.?down|export)\b/i,
  },
];

const defaultSectionOrder = [
  "What it does",
  "Examples",
  "Filter",
  "What is counted",
  "Included and Excluded",
  "Additional details",
  "Add or activate",
  "Reorder",
  "Remove",
  "Clicking a result",
  "Caution",
];

function groupHelperLines(lines: string[], sectionOrder = defaultSectionOrder) {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  const normalizedLines = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const example = line.match(/^(.*\S)\s+(?:for\s+)?example(?::|,)\s*(.+)$/i);
      return example ? [example[1], `Example: ${example[2]}`] : [line];
    });
  const firstExplanation = normalizedLines.findIndex(
    (line) =>
      !/^(?:purpose:|details:|example\b|e\.g\.|caution\b|warning\b|add or activate:|reorder:|remove:)/i.test(
        line,
      ),
  );
  normalizedLines.forEach((line, index) => {
    const key = line.replace(/^(?:Purpose|Details):\s*/i, "").replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const section = /^\s*Purpose:/i.test(line) || index === firstExplanation
      ? "What it does"
      : helperSectionRules.find((rule) => rule.match.test(line))?.title ?? "Additional details";
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
  showPdfExport = true,
  breadcrumb,
}: {
  lines: string[];
  sectionOrder?: string[];
  showPdfExport?: boolean;
  breadcrumb?: string[];
}) {
  const groups = groupHelperLines(lines, sectionOrder);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <div className="pr-1 text-[13px] leading-relaxed">
      {groups.length && showPdfExport ? (
        <div className="mb-2 flex justify-end">
          <HelperPdfButton contentRef={contentRef} breadcrumb={breadcrumb} />
        </div>
      ) : null}
      <div ref={contentRef} className="flex flex-col gap-3">
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
              <ExampleRows items={items} />
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
        {groups.length === 0 ? (
          <p className="rounded-md border border-border bg-secondary/25 p-3 text-foreground">
            No additional details.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function HelperPdfButton({
  contentRef,
  breadcrumb,
}: {
  contentRef: { current: HTMLElement | null };
  breadcrumb?: string[];
}) {
  return (
    <button
      type="button"
      title="Export tooltip content as PDF"
      aria-label="Export tooltip content as PDF"
      onClick={() => {
        const content = contentRef.current;
        if (!content) return;
        const readablePdfText = (value: string) => value.replace(/₹/g, "INR ");
        const clone = content.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button").forEach((button) => button.remove());
        const tables: ExportTable[] = [];
        clone.querySelectorAll("table").forEach((table, index) => {
          const headers = Array.from(table.querySelectorAll("thead th"), (cell) =>
            readablePdfText(cell.textContent?.trim() ?? ""),
          );
          const rows = Array.from(table.querySelectorAll("tbody tr"), (row) =>
            Array.from(row.querySelectorAll("th, td"), (cell) =>
              readablePdfText(cell.textContent?.trim() ?? ""),
            ),
          );
          if (headers.length || rows.length) {
            tables.push({
              title: readablePdfText(
                table.querySelector("caption")?.textContent?.trim() ||
                  table.closest("section")?.querySelector("h3")?.textContent?.trim() ||
                  `Table ${index + 1}`,
              ),
              headers: headers.length ? headers : ["Content"],
              rows: headers.length ? rows : rows.map((row) => [row.join(" | ")]),
            });
          }
          table.remove();
        });
        clone.querySelectorAll("section").forEach((section) => {
          const title = readablePdfText(
            section.querySelector(":scope > h3")?.textContent?.trim() ||
              section.querySelector(":scope > .font-semibold")?.textContent?.trim() ||
              "Details",
          );
          const items = Array.from(section.querySelectorAll("li, p"))
            .filter((item) => item.closest("section") === section && !item.closest("table"))
            .map((item) => readablePdfText(item.textContent?.trim() ?? ""))
            .filter(Boolean);
          if (items.length) {
            tables.push({
              title,
              headers: ["No.", "Explanation"],
              rows: items.map((item, index) => [index + 1, item]),
            });
          }
        });
        const ungroupedItems = Array.from(clone.querySelectorAll("li, p"))
          .filter((item) => !item.closest("section") && !item.closest("table"))
          .map((item) => readablePdfText(item.textContent?.trim() ?? ""))
          .filter(Boolean);
        if (ungroupedItems.length) {
          tables.push({
            title: "Details",
            headers: ["No.", "Explanation"],
            rows: ungroupedItems.map((item, index) => [index + 1, item]),
          });
        }
        if (!tables.length) return;
        const source = (breadcrumb?.filter(Boolean) ?? getTooltipBreadcrumb(content)).map(
          readablePdfText,
        );
        const title = source.at(-1) || "Help and Examples";
        void downloadBackendExport({
          format: "pdf",
          title,
          subtitle: source.join(" > "),
          fileName: `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "help"}.pdf`,
          tables,
        });
      }}
      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <FileDown className="size-3.5" />
      PDF
    </button>
  );
}

function getTooltipBreadcrumb(content: HTMLElement) {
  const pageByPath: Record<string, string> = {
    "/": "Dashboard",
    "/add": "Add File",
    "/search": "Search Files",
    "/quick-entry": "Quick Entry",
    "/reports": "Reports",
    "/settings": "Settings",
  };
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const page = pageByPath[path] ?? path.split("/").filter(Boolean).at(-1) ?? "Software";
  const popup = content.closest<HTMLElement>("[role=tooltip], [role=dialog]");
  const popupId = popup?.id;
  const trigger = popupId
    ? Array.from(document.querySelectorAll<HTMLElement>("[aria-describedby], [aria-controls]")).find(
        (element) =>
          `${element.getAttribute("aria-describedby") ?? ""} ${element.getAttribute("aria-controls") ?? ""}`
            .split(/\s+/)
            .includes(popupId),
      )
    : undefined;
  const triggerLabel = trigger?.getAttribute("aria-label") || trigger?.textContent?.trim();
  const label = triggerLabel?.replace(/\s+(?:help|note|details|information)$/i, "").trim();
  return label ? [page, label] : [page, "Help and Examples"];
}

function renderExampleCell(value: string) {
  const parts = value
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return value;
  return (
    <span className="flex flex-col gap-0.5">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {part}
          {index < parts.length - 1 ? ";" : ""}
        </span>
      ))}
    </span>
  );
}

function ExampleRows({ items }: { items: string[] }) {
  const headerLine = items.find((item) => /^Example table:/i.test(item));
  const headers = headerLine
    ? headerLine
        .replace(/^Example table:\s*/i, "")
        .split("|")
        .map((cell) => cell.trim())
    : [];
  const rows = items.filter((item) => /^Example (?:row|context):/i.test(item));
  if (headers.length && rows.length) {
    const additionalExamples = items
      .filter((item) => !/^Example (?:table|row|context):/i.test(item))
      .map((item) =>
        item.replace(
          /^(?:For\s+)?Example(?::|,)\s*|^Example-[123](?::|,)\s*|^e\.g\.\s*/i,
          "",
        ),
      );
    return (
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-sm border border-primary/20 bg-background/70">
          <table className="w-full min-w-[34rem] border-collapse text-left text-xs text-popover-foreground">
            <thead className="bg-primary/10">
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={`${header}-${index}`}
                    scope="col"
                    className="border-b border-r border-primary/15 px-3 py-2 font-semibold last:border-r-0"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item, rowIndex) => {
                if (/^Example context:/i.test(item)) {
                  return (
                    <tr key={`context-${rowIndex}`}>
                      <th
                        colSpan={headers.length}
                        className="border-b border-primary/20 bg-primary/10 px-3 py-2 text-left font-semibold"
                      >
                        {item.replace(/^Example context:\s*/i, "")}
                      </th>
                    </tr>
                  );
                }
                const cells = item
                  .replace(/^Example row:\s*/i, "")
                  .split("|")
                  .map((cell) => cell.trim());
                return (
                  <tr
                    key={`scenario-${rowIndex}`}
                    className={rowIndex % 2 === 0 ? "bg-primary/5" : "bg-muted/45"}
                  >
                    {headers.map((_, columnIndex) => (
                      <td
                        key={`scenario-${rowIndex}-${columnIndex}`}
                        className="break-words whitespace-pre-line border-b border-r border-primary/15 px-3 py-2 align-top last:border-r-0"
                      >
                        {renderExampleCell(cells[columnIndex] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {additionalExamples.map((example, index) => (
                <tr key={`additional-example-${index}`} className="bg-muted/45">
                  <td
                    colSpan={headers.length}
                    className="break-words border-b border-primary/15 px-3 py-2 align-top"
                  >
                    <span className="font-semibold">Additional example:</span> {example}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const scenarioRows = items.map((item) => {
    const example = item.replace(
      /^(?:For\s+)?Example(?::|,)\s*|^Example-[123](?::|,)\s*|^e\.g\.\s*/i,
      "",
    );
    const delimiter = example.search(/:\s|\s—\s|\smeans\s/i);
    if (delimiter > 0 && delimiter < 90) {
      const scenario = example.slice(0, delimiter).trim();
      const result = example
        .slice(delimiter)
        .trim()
        .replace(/^:\s*|^—\s*|^means\s*/i, "")
        .trim();
      return [scenario, result];
    }
    return ["Example scenario", example];
  });

  return (
    <div className="overflow-x-auto rounded-sm border border-primary/20 bg-background/70">
      <table className="w-full min-w-[28rem] border-collapse text-left text-xs text-popover-foreground">
        <thead className="bg-primary/10">
          <tr>
            <th scope="col" className="w-[35%] border-b border-r border-primary/15 px-3 py-2 font-semibold">
              Scenario / selection
            </th>
            <th scope="col" className="border-b border-primary/15 px-3 py-2 font-semibold">
              Result / interpretation
            </th>
          </tr>
        </thead>
        <tbody>
          {scenarioRows.map(([scenario, result], index) => (
            <tr
              key={`example-${index}`}
              className={index % 2 === 0 ? "bg-primary/5" : "bg-muted/45"}
            >
              <th scope="row" className="border-b border-r border-primary/15 px-3 py-2 align-top font-medium">{scenario}</th>
              <td className="border-b border-primary/15 px-3 py-2 align-top">{result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
