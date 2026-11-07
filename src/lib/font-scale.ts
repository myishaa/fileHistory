export const appFontScaleOptions = [
  { value: 90, label: "Small" },
  { value: 100, label: "Default" },
  { value: 110, label: "Large" },
  { value: 125, label: "Extra large" },
  { value: 140, label: "Very large" },
  { value: 150, label: "Huge" },
  { value: 160, label: "Maximum" },
] as const;

export type AppFontScale = (typeof appFontScaleOptions)[number]["value"];

export const defaultAppFontScale: AppFontScale = 100;

export function normalizeAppFontScale(value: unknown): AppFontScale {
  return appFontScaleOptions.some((option) => option.value === value)
    ? (value as AppFontScale)
    : defaultAppFontScale;
}
