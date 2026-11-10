export type DashboardActivitySummaryState = "loading" | "ready" | "unavailable";

type DashboardActivitySummary = {
  activityCountsForFileScope?: unknown;
  activityCountsForFileScopeByInitiationYear?: unknown[];
};

export function getDashboardActivitySummaryState(
  summary: DashboardActivitySummary | undefined,
  options: { loading: boolean; error?: string },
): DashboardActivitySummaryState {
  if (options.error) return "unavailable";
  if (options.loading) return "loading";

  const hasAuthoritativeActivitySummary = Boolean(
    summary?.activityCountsForFileScope &&
    Array.isArray(summary.activityCountsForFileScopeByInitiationYear),
  );

  if (hasAuthoritativeActivitySummary) return "ready";
  if (!summary) return "loading";
  return "unavailable";
}

export function getDashboardActivitySummaryStatusText(
  state: DashboardActivitySummaryState,
): string {
  return state === "loading" ? "Loading activity summary…" : "Unavailable";
}
