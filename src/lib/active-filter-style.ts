export const activeFilterLabelClass = "text-destructive";

export function filterLabelClass(active: boolean, baseClass: string) {
  return `${baseClass} ${active ? activeFilterLabelClass : ""}`;
}

export function filterControlClass(active: boolean, baseClass: string) {
  return `${baseClass} ${
    active
      ? "border-destructive/70 bg-destructive/10 text-destructive focus:ring-destructive/30"
      : ""
  }`;
}
