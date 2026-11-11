import { ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR, ALL_FILES_YEAR } from "@/lib/year-filter";

export type DashboardRecommendationTab =
  | "status"
  | "liveStatus"
  | "status3"
  | "status4"
  | "snapshot"
  | "analytics"
  | "finance"
  | "fyActivity"
  | "finance1";

export type DashboardRecommendationScope = {
  globalYear: string;
  fileYear: string;
};

const allFilesAnalyticsPanels = new Set([
  "topFirms",
  "firmAnalysis",
  "indentorFirmLinkage",
  "firmPerformance",
]);

const allFileYearsAnalyticsPanels = new Set([
  "paymentPending",
  "delayStatus",
  "suspectedAnomaly",
  "preBidMeetings",
  "bidOpeningSchedule",
  "tcecStatus",
  "cncSummary",
  "topFirms",
  "firmAnalysis",
  "firmPerformance",
  "indentorFirmLinkage",
  "demandProcessingAnalysis",
]);

export function getDashboardRecommendedFilterScope(
  dashboardTab: string | undefined,
  analyticsPanel: string | undefined,
  currentFinancialYear: string,
  status1View?: string,
): DashboardRecommendationScope {
  if (dashboardTab === "analytics") {
    return {
      globalYear: allFilesAnalyticsPanels.has(analyticsPanel ?? "")
        ? ALL_FILES_YEAR
        : currentFinancialYear,
      fileYear: allFileYearsAnalyticsPanels.has(analyticsPanel ?? "")
        ? "all"
        : currentFinancialYear,
    };
  }

  if (dashboardTab === "snapshot" || dashboardTab === "finance1") {
    return { globalYear: currentFinancialYear, fileYear: currentFinancialYear };
  }

  if (dashboardTab === "finance" || dashboardTab === "fyActivity") {
    return { globalYear: currentFinancialYear, fileYear: "all" };
  }

  if (dashboardTab === "status" && status1View && status1View !== "live") {
    return { globalYear: ALL_FILES_YEAR, fileYear: "all" };
  }

  return {
    globalYear: ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
    fileYear: "all",
  };
}
