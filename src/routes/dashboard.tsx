import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "./index";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    analyticsPanel: typeof search.analyticsPanel === "string" ? search.analyticsPanel : undefined,
  }),
  component: Dashboard,
});
