export const chartColorOptions = [
  { color: "#0f766e", label: "Teal" },
  { color: "#2563eb", label: "Blue" },
  { color: "#d97706", label: "Amber" },
  { color: "#be123c", label: "Rose" },
  { color: "#7c3aed", label: "Violet" },
  { color: "#65a30d", label: "Lime" },
  { color: "#0891b2", label: "Cyan" },
  { color: "#475569", label: "Slate" },
  { color: "#e11d48", label: "Crimson" },
  { color: "#ea580c", label: "Orange" },
  { color: "#4f46e5", label: "Indigo" },
  { color: "#16a34a", label: "Green" },
  { color: "#9333ea", label: "Purple" },
  { color: "#0284c7", label: "Sky" },
  { color: "#a16207", label: "Ochre" },
  { color: "#0d9488", label: "Turquoise" },
  { color: "#c026d3", label: "Magenta" },
  { color: "#dc2626", label: "Red" },
  { color: "#84cc16", label: "Chartreuse" },
  { color: "#0369a1", label: "Ocean" },
  { color: "#b45309", label: "Copper" },
  { color: "#7e22ce", label: "Grape" },
  { color: "#15803d", label: "Forest" },
  { color: "#be185d", label: "Berry" },
  { color: "#64748b", label: "Steel" },
] as const;

export const defaultChartColorOrder = chartColorOptions.map((option) => option.color);
export const chartColorCssPalette = chartColorOptions.map(
  (option, index) => `var(--chart-color-${index + 1}, ${option.color})`,
);

export function getRankedChartColor(index: number, order?: readonly string[]) {
  const colors = order?.length ? order : defaultChartColorOrder;
  return colors[((index % colors.length) + colors.length) % colors.length];
}

export function chartColorVariables(order?: readonly string[]) {
  return Object.fromEntries(
    defaultChartColorOrder.map((fallback, index) => [
      `--chart-color-${index + 1}`,
      getRankedChartColor(index, order) ?? fallback,
    ]),
  );
}
