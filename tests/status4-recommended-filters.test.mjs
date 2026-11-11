import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboardSource = fs.readFileSync(
  new URL("../src/routes/index.tsx", import.meta.url),
  "utf8",
);
const recommendationSource = fs.readFileSync(
  new URL("../src/lib/dashboard-filter-recommendations.ts", import.meta.url),
  "utf8",
);

test("dashboard recommendations are applied from router entry after subfilter hydration", () => {
  const status4RecommendationStart = dashboardSource.indexOf(
    "// Reconcile every dashboard option after the persisted subfilter hydration",
  );
  const status4RecommendationEnd = dashboardSource.indexOf(
    "const updateFileYearSelection",
    status4RecommendationStart,
  );
  assert.ok(status4RecommendationStart >= 0);
  assert.ok(status4RecommendationEnd > status4RecommendationStart);

  const recommendationEffect = dashboardSource.slice(
    status4RecommendationStart,
    status4RecommendationEnd,
  );
  assert.match(recommendationEffect, /!routeDashboardTab \|\| appliedFilterCombinationLock/);
  assert.match(
    recommendationEffect,
    /applyDashboardRecommendedFilters\(\s*routeDashboardTab,\s*activeAnalyticsPanel/,
  );
  assert.match(recommendationSource, /dashboardTab === "analytics"/);
  assert.match(
    recommendationSource,
    /dashboardTab === "snapshot" \|\| dashboardTab === "finance1"/,
  );
  assert.match(
    recommendationSource,
    /dashboardTab === "finance" \|\| dashboardTab === "fyActivity"/,
  );
  assert.match(recommendationSource, /dashboardTab === "status" && status1View/);
  assert.match(recommendationSource, /ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR/);
});

test("tab clicks leave recommendation application to the destination route", () => {
  const selectTabStart = dashboardSource.indexOf("const selectDashboardTab =");
  const selectAnalyticsPanelStart = dashboardSource.indexOf(
    "const selectAnalyticsPanel =",
    selectTabStart,
  );
  assert.ok(selectTabStart >= 0);
  assert.ok(selectAnalyticsPanelStart > selectTabStart);
  const selectTabSource = dashboardSource.slice(selectTabStart, selectAnalyticsPanelStart);
  assert.doesNotMatch(selectTabSource, /applyDashboardRecommendedFilters/);
  assert.match(selectTabSource, /navigate\(\{\s*to: "\/dashboard"/);
});
