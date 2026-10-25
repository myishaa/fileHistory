import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "./index";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    analyticsPanel: typeof search.analyticsPanel === "string" ? search.analyticsPanel : undefined,
    noticeBoardView:
      typeof search.noticeBoardView === "string" ? search.noticeBoardView : undefined,
    boardMetric: typeof search.boardMetric === "string" ? search.boardMetric : undefined,
  }),
  component: Dashboard,
});
