import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  Download,
  FilePlus2,
  Info,
  LayoutDashboard,
  Moon,
  ScanLine,
  Search,
  Settings,
  Sun,
  UserRound,
  LogOut,
  Bell,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  store,
  useActiveUser,
  useFileProcessingNotifications,
  useMessages,
  useSettings,
} from "@/lib/files-store";
import {
  ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
  ALL_ACTIVE_FILES_YEAR,
  ALL_FILES_YEAR,
  displayFinancialYearLabel,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";
import { filterControlClass, filterLabelClass } from "@/lib/active-filter-style";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadBackendExport, type ExportTable } from "@/lib/export-download";

const nav = [
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/quick-entry", label: "Quick Entry", icon: ScanLine },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locationSearch = useRouterState({ select: (s) => s.location.search });
  const navigate = useNavigate();
  const settings = useSettings();
  const messages = useMessages();
  const fileProcessingNotifications = useFileProcessingNotifications();
  const activeUser = useActiveUser();
  const [anomalyWarningCount, setAnomalyWarningCount] = useState(0);
  const [ipAccessWarningCount, setIpAccessWarningCount] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [filterGuideOpen, setFilterGuideOpen] = useState(false);
  const isDark = settings.theme === "dark";
  const canManageAdminSettings = activeUser?.role === "admin";
  const canUpdateAppearance = Boolean(activeUser);
  const canSelectYear = Boolean(activeUser);
  const canViewUserSettings = Boolean(activeUser);
  const dashboardTab = typeof locationSearch.tab === "string" ? locationSearch.tab : undefined;
  const isFinanceSnapshotContext = pathname === "/dashboard" && dashboardTab === "finance1";
  const effectiveSelectedYear = isFinanceSnapshotContext
    ? normalizeFinancialYearLabel(settings.selectedYear) || settings.financialYear
    : settings.selectedYear;
  const globalFilterHelp = getGlobalFilterHelp(effectiveSelectedYear, settings.financialYear);
  const filterCombinationGuide = getFilterCombinationGuide(settings.financialYear);
  const recommendedFilterLabel = getRecommendedFilterLabel(
    pathname,
    dashboardTab,
    settings.financialYear,
  );
  const globalFilterActive = isGlobalFilterNonSuggested(
    pathname,
    dashboardTab,
    effectiveSelectedYear,
    settings.financialYear,
  );
  const canAddFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const isQuickViewerRole =
    activeUser?.role === "universal_viewer" ||
    activeUser?.role === "viewer" ||
    activeUser?.role === "division_user";
  const canUseQuickEntry = canAddFiles || isQuickViewerRole;
  const visibleNav = nav.filter((item) => {
    if (item.to === "/settings") return canViewUserSettings;
    if (item.to === "/add") return canAddFiles;
    if (item.to === "/quick-entry") return canUseQuickEntry;
    return true;
  });
  const isViewer = activeUser?.role === "viewer" || activeUser?.role === "division_user";
  const pendingMessages = useMemo(
    () => messages.filter((message) => message.status === "pending"),
    [messages],
  );
  const resolvedMessages = useMemo(
    () => messages.filter((message) => message.status === "resolved"),
    [messages],
  );
  const viewerUnreadResolved = useMemo(
    () => resolvedMessages.filter((message) => !message.viewedAt),
    [resolvedMessages],
  );
  const messageWarningCount = isViewer
    ? pendingMessages.length + viewerUnreadResolved.length
    : pendingMessages.length;
  const fileProcessingWarningCount = isViewer
    ? fileProcessingNotifications.filter((notification) => notification.status === "pending").length
    : 0;
  const bellCount = messageWarningCount + anomalyWarningCount + fileProcessingWarningCount;
  const adminBellCount = bellCount + ipAccessWarningCount;
  useEffect(() => {
    if (!activeUser) {
      setAnomalyWarningCount(0);
      return;
    }
    let cancelled = false;
    const selectedYear = settings.selectedYear || settings.financialYear;
    const loadAnomalyCount = () => {
      void store
        .countSuspectedAnomalies(selectedYear)
        .then((count) => {
          if (!cancelled) setAnomalyWarningCount(count);
        })
        .catch((error) => {
          console.error(error);
          if (!cancelled) setAnomalyWarningCount(0);
        });
    };
    loadAnomalyCount();
    const intervalId = window.setInterval(loadAnomalyCount, 60_000);
    window.addEventListener("focus", loadAnomalyCount);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadAnomalyCount);
    };
  }, [activeUser, settings.financialYear, settings.selectedYear]);
  useEffect(() => {
    if (activeUser?.role !== "admin") {
      setIpAccessWarningCount(0);
      return;
    }
    let cancelled = false;
    const loadIpCount = () => {
      void store
        .getIpAccessConfig()
        .then((config) => {
          if (!cancelled) setIpAccessWarningCount(config.pendingCount);
        })
        .catch((error) => {
          console.error(error);
          if (!cancelled) setIpAccessWarningCount(0);
        });
    };
    loadIpCount();
    const intervalId = window.setInterval(loadIpCount, 60_000);
    window.addEventListener("focus", loadIpCount);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadIpCount);
    };
  }, [activeUser?.role]);
  const openMessages = () => {
    setWarningsOpen(false);
    navigate({
      to: "/messages",
      search: {
        view: undefined,
        page: undefined,
        division: undefined,
        section: undefined,
      },
    });
  };
  const openFileProcessing = () => {
    setWarningsOpen(false);
    navigate({
      to: "/messages",
      search: {
        view: "processing",
        page: undefined,
        division: undefined,
        section: undefined,
      },
    });
  };
  const openSuspectedAnomalies = () => {
    setWarningsOpen(false);
    navigate({
      to: "/dashboard",
      search: {
        tab: "analytics",
        analyticsPanel: "suspectedAnomaly",
      },
    });
  };
  const openIpAccessSettings = () => {
    setWarningsOpen(false);
    navigate({
      to: "/settings",
      search: {
        section: "ipAccess",
      },
    });
  };
  const yearOptions = Array.from(
    new Set(
      [settings.financialYear, settings.selectedYear, ...settings.financialYears]
        .map((year) => normalizeFinancialYearLabel(year))
        .filter(
          (year): year is string =>
            Boolean(year) &&
            year !== ALL_FILES_YEAR &&
            year !== ALL_ACTIVE_FILES_YEAR &&
            year !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
        ),
    ),
  ).sort((a, b) => b.localeCompare(a));
  useEffect(() => {
    if (!isFinanceSnapshotContext) return;
    const normalizedSelectedYear = normalizeFinancialYearLabel(settings.selectedYear);
    const nextYear =
      normalizedSelectedYear && yearOptions.includes(normalizedSelectedYear)
        ? normalizedSelectedYear
        : settings.financialYear || yearOptions[0];
    if (nextYear && settings.selectedYear !== nextYear) {
      store.updateSessionSelectedYear(nextYear);
    }
  }, [isFinanceSnapshotContext, settings.financialYear, settings.selectedYear, yearOptions]);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
      <div className="min-h-14 px-4 lg:px-6 py-2.5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 mr-2">
          <div className="size-8 rounded-md border border-border bg-secondary grid place-items-center">
            <UserRound className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-medium text-muted-foreground">User</div>
            <div className="text-sm font-semibold">{activeUser?.name ?? "Not signed in"}</div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm transition-colors " +
                  (active
                    ? "bg-secondary text-foreground border border-border"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setWarningsOpen((open) => !open)}
              title="Warnings"
              aria-label="Warnings"
              aria-expanded={warningsOpen}
              className="relative size-8 rounded-md border border-border bg-card hover:bg-accent grid place-items-center"
            >
              <Bell className="size-4" />
              {adminBellCount ? (
                <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                  {adminBellCount}
                </span>
              ) : null}
            </button>
            {warningsOpen ? (
              <div className="absolute right-0 top-10 z-30 w-72 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                <div className="border-b border-border px-2 pb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Warnings
                </div>
                <div className="mt-2 space-y-1">
                  {isViewer ? (
                    <button
                      type="button"
                      onClick={openFileProcessing}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                    >
                      <span>
                        <span className="block text-sm font-medium">File Processing</span>
                        <span className="block text-xs text-muted-foreground">
                          Open file change notifications
                        </span>
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {fileProcessingWarningCount}
                      </span>
                    </button>
                  ) : null}
                  {activeUser?.role === "admin" ? (
                    <button
                      type="button"
                      onClick={openIpAccessSettings}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                    >
                      <span>
                        <span className="block text-sm font-medium">New IP login attempts</span>
                        <span className="block text-xs text-muted-foreground">
                          Open IP access settings
                        </span>
                      </span>
                      <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                        {ipAccessWarningCount}
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={openSuspectedAnomalies}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  >
                    <span>
                      <span className="block text-sm font-medium">Suspected anomaly observed</span>
                      <span className="block text-xs text-muted-foreground">
                        Open suspected anomaly
                      </span>
                    </span>
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                      {anomalyWarningCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={openMessages}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  >
                    <span>
                      <span className="block text-sm font-medium">Message warnings</span>
                      <span className="block text-xs text-muted-foreground">Open messages</span>
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                      {messageWarningCount}
                    </span>
                  </button>
                  {!adminBellCount ? (
                    <div className="rounded-md px-2 py-2 text-sm text-muted-foreground">
                      No active warnings.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <label
                className={filterControlClass(
                  globalFilterActive,
                  "flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1",
                )}
              >
                <CalendarDays
                  className={
                    "size-4 " +
                    (globalFilterActive ? "text-destructive" : "text-muted-foreground")
                  }
                />
                <span
                  className={filterLabelClass(
                    globalFilterActive,
                    "text-[11px] font-medium text-muted-foreground",
                  )}
                >
                  Global Filter
                </span>
                <select
                  data-testid="global-year-select"
                  value={effectiveSelectedYear}
                  onChange={(event) => store.updateSessionSelectedYear(event.target.value)}
                  disabled={!canSelectYear}
                  className={
                    "h-6 min-w-20 bg-transparent text-sm font-semibold outline-none " +
                    (globalFilterActive ? "text-destructive" : "text-foreground")
                  }
                >
                  {!isFinanceSnapshotContext ? (
                    <>
                      <option value={ALL_FILES_YEAR}>All files</option>
                      <option value={ALL_ACTIVE_FILES_YEAR}>All active files</option>
                      <option value={ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR}>
                        Active + current FY closed
                      </option>
                    </>
                  ) : null}
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {displayFinancialYearLabel(year)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setFilterGuideOpen(true)}
                title="Global Filter help"
                aria-label="Global Filter help"
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground"
              >
                <Info className="size-3" />
              </button>
            </div>
            <div
              className="flex max-w-[24rem] items-center gap-1 truncate pl-1 text-[11px] font-semibold leading-none text-foreground"
              title={`Recommended: ${recommendedFilterLabel.activityYear} + ${recommendedFilterLabel.fileYear}`}
            >
              <span>Recommended:</span>
              <span>{recommendedFilterLabel.activityYear}</span>
              <span>+</span>
              <span>{recommendedFilterLabel.fileYear}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => store.updateSettings({ theme: isDark ? "light" : "dark" })}
            disabled={!canUpdateAppearance}
            title={isDark ? "Switch to white theme" : "Switch to dark theme"}
            aria-label={isDark ? "Switch to white theme" : "Switch to dark theme"}
            className="size-8 rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 grid place-items-center"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => void store.logout()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium hover:bg-accent"
          >
            <LogOut className="size-4" />
            Logout
          </button>
        </div>
      </div>
      <FilterCombinationGuideDialog
        open={filterGuideOpen}
        onOpenChange={setFilterGuideOpen}
        currentTitle={globalFilterHelp.title}
        currentDescription={globalFilterHelp.description}
        currentFinancialYear={settings.financialYear}
        meaningRows={filterCombinationGuide.meaningRows}
        rows={filterCombinationGuide.rows}
      />
    </header>
  );
}

type FilterCombinationGuideRow = {
  page: string;
  activityYear: string;
  fileInitiationYear: string;
  useFor: string;
  note: string;
  examples: string[];
  emphasis?: "software" | "finance" | "reports";
};

type FilterMeaningRow = {
  filter: string;
  useWhen: string;
  shows: string;
  examples: string[];
};

function FilterCombinationGuideDialog({
  open,
  onOpenChange,
  currentTitle,
  currentDescription,
  currentFinancialYear,
  meaningRows,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  currentDescription: string;
  currentFinancialYear: string;
  meaningRows: FilterMeaningRow[];
  rows: FilterCombinationGuideRow[];
}) {
  const exportPdf = () => {
    const tables: ExportTable[] = [
      {
        title: "How Global Filter Works",
        headers: ["Term", "Meaning", "Examples"],
        rows: [
          [
            "Specific FY",
            "A selected FY is an activity context. It can include files started in that FY, older files open/continued in that FY, and older files with reportable work in that FY.",
            `File started in ${displayFinancialYearLabel(currentFinancialYear)}; older file open/continued in ${displayFinancialYearLabel(currentFinancialYear)}; older file with work recorded in ${displayFinancialYearLabel(currentFinancialYear)}.`,
          ],
          [
            "File Initiation Year",
            "The financial year in which the file was received/started. It narrows the file group after the Global Filter is selected.",
            `Global Filter ${displayFinancialYearLabel(currentFinancialYear)} + Subfilter 2025-26 means files started in 2025-26 that are visible in the ${displayFinancialYearLabel(currentFinancialYear)} context.`,
          ],
        ],
        columnWidths: [90, 210, 280],
      },
      {
        title: "Specific FY vs All Active Files vs All Files",
        headers: [
          "Filter option",
          "Basic meaning",
          "Older file active/continued or with activity in current FY",
          "Closed file",
          "Open old file with no activity in current FY",
          "Demand cancelled",
          "S.O. cancelled / fully S.O.-cancelled",
        ],
        rows: [
          [
            "Specific FY",
            "Shows files connected with the selected FY.",
            "Included if the file was open/continued in the selected FY or had relevant work recorded in that FY.",
            "Can be included if it was closed in the selected FY or had relevant work recorded in that FY.",
            "Included if it remained open/continued in the selected FY, even if no specific event is recorded yet.",
            "Excluded from normal working/statistical panels; available through cancellation-specific filters.",
            "Not treated as an active working file. Can remain visible in history/statistical panels if it belongs to the selected FY scope.",
          ],
          [
            "All files",
            "Shows the full accessible database, irrespective of FY or current open/closed status.",
            "Included because All files does not restrict by activity year or open status.",
            "Included, because closed files remain part of the full database.",
            "Included, because All files includes old/open files also.",
            "Still excluded from normal working/statistical panels; use cancellation filters to review it.",
            "Can appear in full-database history/statistical views; value/liability panels normally exclude cancelled S.O. rows.",
          ],
          [
            "All active files",
            "Shows files that are open today, irrespective of FY.",
            "Included only if the file is still open today.",
            "Not included, because it is no longer active.",
            "Included because it is open today.",
            "Not included as active work.",
            "Fully S.O.-cancelled files are not active. Partly cancelled files can remain if another S.O. is still active.",
          ],
          [
            "Active files + current FY closed",
            "Shows files open today plus files closed during the current FY.",
            "Included if the file is still open today or was closed during the current FY.",
            "Included only if it was closed during the current FY.",
            "Included because it is open today.",
            "Not included as active/current FY closed work.",
            "Fully S.O.-cancelled files are not active. They appear only in cancellation/history/statistical views where allowed.",
          ],
        ],
        columnWidths: [80, 95, 120, 85, 105, 95, 120],
      },
      {
        title: "Global Filter Examples",
        headers: ["Option", "Examples"],
        rows: meaningRows.map((row) => [row.filter, row.examples.join("; ")]),
        columnWidths: [130, 450],
      },
      {
        title: "Filter Recommendations",
        headers: [
          "Page / Option",
          "Global Filter",
          "Subfilter",
          "Use for",
          "What it shows - examples",
          "Note",
        ],
        rows: rows.map((row) => [
          row.page,
          row.activityYear,
          row.fileInitiationYear,
          row.useFor,
          row.examples.join("; "),
          row.note,
        ]),
        columnWidths: [75, 82, 82, 115, 165, 120],
      },
    ];
    void downloadBackendExport({
      format: "pdf",
      title: "Global and Subfilter Guide",
      subtitle: `Current selection: ${currentTitle}`,
      description: currentDescription,
      fileName: "global-subfilter-guide.pdf",
      tables,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[96vw] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg">Global Filter Guide</DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                Recommended Global Filter and Subfilter combinations.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              <Download className="size-4" />
              Export PDF
            </button>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(92vh-5.5rem)] overflow-y-auto px-5 py-4">
          <div className="mb-4 rounded-md border border-border bg-secondary/25 px-3 py-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Current Global Filter Selection
            </div>
            <div className="mt-1 text-sm font-semibold">{currentTitle}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{currentDescription}</p>
          </div>

          <div className="mb-4 rounded-md border border-primary/25 bg-primary/5 px-4 py-3">
            <div className="text-sm font-bold text-foreground">How Specific FY Works</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              When you select a specific FY in Global Filter, it is not only the file start year.
              It also covers older files that remained open/continued in that FY or had relevant
              work recorded in that FY.
            </p>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <div className="font-semibold text-foreground">Example: Global Filter 2026-27</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>File started in FY 2026-27.</li>
                  <li>Older file remained open/continued in FY 2026-27.</li>
                  <li>Older file had reportable work recorded in FY 2026-27.</li>
                  <li>
                    Event-date reports then use their own event date, such as S.O. date, payment
                    date, meeting date, BG expiry, delivery, or job completion.
                  </li>
                </ul>
              </div>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <div className="font-semibold text-foreground">Example: File Initiation Year</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>File received/started in FY 2025-26.</li>
                  <li>
                    If Global Filter is 2026-27, that 2025-26 file can still appear only when it is
                    visible in the 2026-27 context.
                  </li>
                  <li>Choosing All file years keeps every initiation year eligible.</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mb-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[1580px] border-collapse text-sm">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th
                    className="border-b border-border px-3 py-2 text-left text-sm font-bold text-foreground"
                    colSpan={7}
                  >
                    Specific FY vs All Files vs All Active Files
                  </th>
                </tr>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Filter Option
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Basic Meaning
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Older File Active/Continued or with Activity in Current FY
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Closed File
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Open Old File with No Activity in Current FY
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Demand Cancelled
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    S.O. Cancelled / Fully S.O.-cancelled
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    filter: "Specific FY",
                    meaning:
                      "Shows files connected with the selected FY.",
                    older:
                      "Included if the file was open/continued in the selected FY or had relevant work recorded in that FY.",
                    closed:
                      "Can be included if it was closed in the selected FY or had relevant work recorded in that FY.",
                    oldOpen:
                      "Included if it remained open/continued in selected FY, even if no specific event is recorded yet.",
                    demandCancelled:
                      "Excluded from normal working/statistical panels; available through cancellation-specific filters.",
                    soCancelled:
                      "Not treated as an active working file. Can remain visible in history/statistical panels if it belongs to the selected FY scope.",
                  },
                  {
                    filter: "All files",
                    meaning:
                      "Shows the full accessible database, irrespective of FY or current open/closed status.",
                    older:
                      "Included because All files does not restrict by activity year or open status.",
                    closed: "Included, because closed files remain part of the full database.",
                    oldOpen: "Included, because All files includes old/open files also.",
                    demandCancelled:
                      "Still excluded from normal working/statistical panels; use cancellation filters to review it.",
                    soCancelled:
                      "Can appear in full-database history/statistical views; value/liability panels normally exclude cancelled S.O. rows.",
                  },
                  {
                    filter: "All active files",
                    meaning: "Shows files that are open today, irrespective of FY.",
                    older: "Included only if the file is still open today.",
                    closed: "Not included, because it is no longer active.",
                    oldOpen: "Included because it is open today.",
                    demandCancelled: "Not included as active work.",
                    soCancelled:
                      "Fully S.O.-cancelled files are not active. Partly cancelled files can remain if another S.O. is still active.",
                  },
                  {
                    filter: "Active files + current FY closed",
                    meaning: "Shows files open today plus files closed during the current FY.",
                    older:
                      "Included if the file is still open today or was closed during the current FY.",
                    closed: "Included only if it was closed during the current FY.",
                    oldOpen: "Included because it is open today.",
                    demandCancelled: "Not included as active/current FY closed work.",
                    soCancelled:
                      "Fully S.O.-cancelled files are not active. They appear only in cancellation/history/statistical views where allowed.",
                  },
                ].map((row) => (
                  <tr key={row.filter} className="border-t border-border">
                    <td className="px-3 py-2 align-top font-semibold">{row.filter}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.meaning}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.older}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.closed}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.oldOpen}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {row.demandCancelled}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.soCancelled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mb-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th
                    className="border-b border-border px-3 py-2 text-left text-sm font-bold text-foreground"
                    colSpan={2}
                  >
                    Global Filter Examples
                  </th>
                </tr>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Option
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Examples
                  </th>
                </tr>
              </thead>
              <tbody>
                {meaningRows.map((row) => (
                  <tr key={row.filter} className="border-t border-border">
                    <td className="px-3 py-2 align-top font-semibold">{row.filter}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      <ul className="list-disc space-y-1 pl-4">
                        {row.examples.map((example) => (
                          <li key={example}>{example}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th
                    className="border-b border-border px-3 py-2 text-left text-sm font-bold text-foreground"
                    colSpan={6}
                  >
                    Filter Recommendations
                  </th>
                </tr>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Page / Option
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Global Filter
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Subfilter
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Best Use
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    What It Shows
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.page}
                    className={
                      "border-t border-border " +
                      (row.emphasis === "software"
                        ? "bg-sky-500/10"
                        : row.emphasis === "finance"
                          ? "bg-emerald-500/10"
                          : row.emphasis === "reports"
                            ? "bg-amber-500/10"
                            : "")
                    }
                  >
                    <td className="px-3 py-2 align-top font-semibold">{row.page}</td>
                    <td className="px-3 py-2 align-top">{row.activityYear}</td>
                    <td className="px-3 py-2 align-top">{row.fileInitiationYear}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.useFor}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      <ul className="list-disc space-y-1 pl-4">
                        {row.examples.map((example) => (
                          <li key={example}>{example}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getFilterCombinationGuide(currentFinancialYear: string) {
  const currentFyLabel = displayFinancialYearLabel(currentFinancialYear);
  const softwareDefault = "Active + current FY closed";
  const currentFy = `Current FY ${currentFyLabel}`;
  const allFileYears = "All file years";

  return {
    meaningRows: [
      {
        filter: `Specific FY, e.g. ${currentFyLabel}`,
        useWhen: "You want one FY context.",
        shows:
          "Files started in that FY plus older files visible in that FY context.",
        examples: [
          `Use ${currentFyLabel} to see work connected with that FY.`,
          `A file started in ${currentFyLabel} is included.`,
          `An older file can appear if it remained open/continued in ${currentFyLabel}.`,
          `Event reports count their own event dates inside ${currentFyLabel}.`,
        ],
      },
      {
        filter: "All files",
        useWhen: "You want a cumulative or full database view.",
        shows: "All accessible files, including active, closed, and cancelled files.",
        examples: [
          "A closed old file is included.",
          "A cancelled file is included unless the specific card/report excludes it by rule.",
          "Use this for full-database cumulative review.",
          "Avoid this for selected-FY activity questions.",
        ],
      },
      {
        filter: "All active files",
        useWhen: "You want only files that are still open today.",
        shows: "Currently open, non-cancelled files across all initiation years.",
        examples: [
          "A 2024-25 file still open today is included.",
          "A file closed yesterday is not included.",
          "A cancelled file is not included.",
          "Use this when only today's open file list matters.",
        ],
      },
      {
        filter: "Active + current FY closed",
        useWhen: "You want current monitoring, including files closed during this FY.",
        shows: `All active files plus files closed during current FY ${currentFyLabel}; cancelled files are excluded.`,
        examples: [
          "A 2024-25 file still open today is included.",
          `A file closed during ${currentFyLabel} is also included.`,
          `A file closed before ${currentFyLabel} is excluded.`,
          "Use this for normal operational monitoring.",
        ],
      },
      {
        filter: "File Initiation Year subfilter",
        useWhen: "You want to narrow the selected global filter to files started in one FY.",
        shows: "Only files whose initiation/received date belongs to the chosen file initiation FY.",
        examples: [
          `Global Filter ${currentFyLabel} + Subfilter 2025-26 shows only files started in 2025-26 within the ${currentFyLabel} context.`,
          `Global Filter ${currentFyLabel} + Subfilter All file years keeps all initiation years eligible.`,
          "FY Snapshot locks this subfilter to the same selected FY.",
        ],
      },
    ] satisfies FilterMeaningRow[],
    rows: [
      {
        page: "Search File",
        activityYear: "User's current selection",
        fileInitiationYear: "User's current selection",
        useFor: "Investigation and drill-down from any module.",
        note: "Search should preserve the user's chosen context and exact clicker source.",
        examples: [
          "Opening from Payment Pending should show the payment-pending file set.",
          "Opening from Pre-bid Completed FY 2026-27 should preserve that breadcrumb context.",
          "Manual Search can use any user-selected global/subfilter combination.",
        ],
      },
      {
        page: "Status-1",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
        useFor: "Day-to-day current monitoring.",
        note: "Shows active files plus files closed during the current FY.",
        examples: [
          "Best starting point for today's pending and recently completed work.",
          "Shows the files your team is still handling, plus files closed during the current FY.",
          "Use this when you want the normal operational dashboard view.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-2",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
        useFor: "Current operational status view.",
        note: "Use the same operational default as Status-1.",
        examples: [
          "Use this to review the present stage-wise position of the working file set.",
          "Good for checking where files are pending right now.",
          "Keeps the view aligned with Status-1 for easier comparison.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-3",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
        useFor: "Current milestone/status breakup.",
        note: "Best for present workflow counters.",
        examples: [
          "Use this when you want Status-1 information in a compact table form.",
          "Good for comparing S.O., delivery, payment, and related workflow positions together.",
          "Helps cross-check detailed status counts without changing the file context.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-4",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
        useFor: "Pre-SO Live Status.",
        note: "Best for current live flow rather than historical FY activity.",
        examples: [
          "Use this for files before S.O. placement.",
          "Good for seeing demand, approval, vetting, bidding, and pre-S.O. movement.",
          "Not meant for payment, delivery, or post-S.O. monitoring.",
        ],
        emphasis: "software",
      },
      {
        page: "Analytics",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
        useFor: "FY activity such as S.O., CNC, TCEC, pre-bid, BG expiry, delivery, and inflow.",
        note: "Use specific File Initiation Year only when studying one initiation batch.",
        examples: [
          "Use this to study activity that happened during the selected FY, even for older files.",
          "Good for FY-wise S.O., meeting, BG, delivery, payment-pending, and workload analysis.",
          "Select a specific Subfilter only when you want to study one initiation-year batch.",
        ],
        emphasis: "reports",
      },
      {
        page: "Finance",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
        useFor: "Current FY payment, carry-forward movement, and firm-type activity.",
        note: "Best default for current FY finance monitoring.",
        examples: [
          "Use this for current FY finance movement across all file years.",
          "Good for payments, carry-forward, cleared carry-forward, and firm-type finance analysis.",
          "Older files remain included when their finance activity belongs to the selected FY.",
        ],
        emphasis: "reports",
      },
      {
        page: "FY Snapshot",
        activityYear: "Select any FY",
        fileInitiationYear: "Locked to same FY",
        useFor: "Review files started in one selected FY, with value, payment, liability, and status.",
        note: "Only FY options are shown; for a running FY, figures are live and provisional.",
        examples: [
          "Use this to review one initiation FY as a self-contained file group.",
          "Good for year-end position, present paid/unpaid position, and file-type breakup.",
          "Running FY figures stay provisional until the FY is complete.",
        ],
      },
      {
        page: "Reports",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
        useFor: "FY reports and event-date based report rows.",
        note: "Rows should reflect activity inside the selected FY irrespective of initiation year.",
        examples: [
          "Use this for FY-wise report rows based on the report's event date.",
          "Good for month-wise S.O., delivery, BG expiry, meetings, and similar schedules.",
          "Older files can appear when the selected report event happened in the selected FY.",
        ],
        emphasis: "reports",
      },
      {
        page: "Cash Out Go Reports",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
        useFor: "Current FY cash outgo and payment monitoring.",
        note: "For selected month reports, rows should stay within FY start to selected month.",
        examples: [
          "Use this for actual and expected cash movement during the selected FY.",
          "Good for month-wise payment, pending bills, due payments, and cash-out planning.",
          "Older files can appear when their payment or cash-out event belongs to the selected FY.",
        ],
        emphasis: "reports",
      },
      {
        page: "Quick Entry",
        activityYear: "No change",
        fileInitiationYear: "No change",
        useFor: "Barcode/status/file entry.",
        note: "Quick Entry opens exact files only and should not change analytical filters.",
        examples: [
          "Use this for fast entry, barcode lookup, or direct file opening.",
          "It should open the selected file without disturbing dashboard/report filters.",
        ],
      },
      {
        page: "Old-file performance",
        activityYear: currentFy,
        fileInitiationYear: "Specific earlier FY",
        useFor: "Study how older files performed during the current FY.",
        note: "Example: Global Filter 2026-27 + Subfilter 2025-26.",
        examples: [
          "Use this to study how one older initiation-year batch performed during a later FY.",
          "Good for questions like: how did 2025-26 files move during 2026-27?",
          "Not suitable for overall FY reporting because other initiation years are intentionally excluded.",
        ],
      },
      {
        page: "Full database cumulative view",
        activityYear: "All files",
        fileInitiationYear: "Entire database / All file years",
        useFor: "Full historical/cumulative position.",
        note: "Use carefully because it is not a current FY activity view.",
        examples: [
          "Use this when you want a full-database cumulative position.",
          "Good for total historical Finance values and broad database review.",
          "Not suitable for selected-FY activity analysis.",
        ],
      },
    ] satisfies FilterCombinationGuideRow[],
    notes: [
      "Global Filter controls the FY context: files initiated in that FY, older files active/continued in that FY, and files with activity in that FY. Subfilter narrows the file pool by initiation year.",
      "Do not auto-switch filters when entering Finance, Reports, Search, or Quick Entry.",
      "For current day-to-day operations, use Active + current FY closed with All file years.",
      `For Finance and Reports, the most useful default is Global Filter = Current FY ${currentFyLabel} with Subfilter = All file years.`,
      "FY Snapshot shows only FY options in Global Filter and locks Subfilter to the same FY.",
      "Specific initiation FY is useful for batch/cohort analysis, not for general current FY reporting.",
    ],
  };
}

function getRecommendedFilterLabel(
  pathname: string,
  dashboardTab: string | undefined,
  currentFinancialYear: string,
) {
  const currentFyLabel = `Current FY ${displayFinancialYearLabel(currentFinancialYear)}`;
  if (pathname === "/quick-entry") {
    return {
      activityYear: "No filter change",
      fileYear: "Exact file only",
    };
  }
  if (pathname === "/search") {
    return {
      activityYear: "Selected context",
      fileYear: "Selected file year",
    };
  }
  if (pathname === "/reports") {
    return {
      activityYear: currentFyLabel,
      fileYear: "All file years",
    };
  }
  if (pathname === "/dashboard") {
    if (dashboardTab === "analytics") {
      return {
        activityYear: currentFyLabel,
        fileYear: "All file years",
      };
    }
    if (dashboardTab === "finance") {
      return {
        activityYear: currentFyLabel,
        fileYear: "All file years",
      };
    }
    if (dashboardTab === "finance1") {
      return {
        activityYear: "Selected FY",
        fileYear: "Same FY",
      };
    }
    return {
      activityYear: "Active + current FY closed",
      fileYear: "All file years",
    };
  }
  return {
    activityYear: "Selected context",
    fileYear: "Selected file year",
  };
}

function isGlobalFilterNonSuggested(
  pathname: string,
  dashboardTab: string | undefined,
  selectedYear: string | undefined,
  currentFinancialYear: string,
) {
  if (pathname === "/reports") return selectedYear !== currentFinancialYear;
  if (pathname !== "/dashboard") return false;
  if (dashboardTab === "finance1") return false;
  if (dashboardTab === "finance" || dashboardTab === "analytics") {
    return selectedYear !== currentFinancialYear;
  }
  return selectedYear !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function getGlobalFilterHelp(selectedYear: string | undefined, currentFinancialYear: string) {
  const normalizedSelected = normalizeFinancialYearLabel(selectedYear) || currentFinancialYear;
  const currentFyLabel = displayFinancialYearLabel(currentFinancialYear);
  const currentFyRange = getFinancialYearDateRangeLabel(currentFinancialYear);
  const selectedFyLabel = displayFinancialYearLabel(normalizedSelected);
  const title =
    normalizedSelected === ALL_FILES_YEAR
      ? "All files"
      : normalizedSelected === ALL_ACTIVE_FILES_YEAR
        ? "All active files"
        : normalizedSelected === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
          ? "Active + current FY closed"
          : `FY ${selectedFyLabel}`;
  const description =
    normalizedSelected === ALL_FILES_YEAR
      ? "Shows the full accessible file universe. Use the File Initiation Year subfilter to restrict this to files initiated in a particular FY."
      : normalizedSelected === ALL_ACTIVE_FILES_YEAR
        ? "Shows files that are not closed and not cancelled, across all file initiation years unless the File Initiation Year subfilter narrows them."
        : normalizedSelected === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
          ? `Shows all active files, plus files closed during current FY ${currentFyLabel}${currentFyRange ? ` (${currentFyRange})` : ""}. Cancelled files remain excluded.`
          : `Shows FY ${selectedFyLabel} context: files initiated in that FY, plus older files active/continued in that FY or having activity in that FY.`;

  return {
    title,
    description,
    fyRows: [
      {
        filter: "All files",
        filePool: "All accessible database files",
        reportFy: `Current FY from Settings: ${currentFyLabel}`,
      },
      {
        filter: "All active files",
        filePool: "Active, non-cancelled files",
        reportFy: `Current FY from Settings: ${currentFyLabel}`,
      },
      {
        filter: "Active + current FY closed",
        filePool: `Active files + files closed during ${currentFyLabel}`,
        reportFy: `Current FY from Settings: ${currentFyLabel}`,
      },
      {
        filter: `Specific FY, e.g. ${selectedFyLabel}`,
        filePool: "Files initiated in that FY, older active/continued files, and files with activity in that FY",
        reportFy: `Same selected FY, e.g. ${selectedFyLabel}`,
      },
    ],
    options: [
      {
        label: "Finance default",
        description: `Global Filter = current FY ${currentFyLabel}; Subfilter = All file years. Use this for current-FY payments, carry-forward movement, and firm-type activity across all initiation years.`,
        className: "text-emerald-700 dark:text-emerald-300",
      },
      {
        label: "Reports default",
        description: `Global Filter = current FY ${currentFyLabel}; Subfilter = All file years. Use this for current-FY reports, cash outgo, month-wise activity, and older-file activity happening in the current FY.`,
        className: "text-amber-700 dark:text-amber-300",
      },
      {
        label: "Software default",
        description: `Global Filter = Active + current FY closed. Use this for day-to-day operational monitoring of active files plus files closed during current FY ${currentFyLabel}.`,
        className: "text-sky-700 dark:text-sky-300",
      },
      {
        label: "All files",
        description:
          "Shows all accessible database files, including active, closed, and cancelled. Use File Initiation Year = Entire database for no initiation-year restriction, or select one FY for files initiated in that FY.",
      },
      {
        label: "All active files",
        description:
          "Shows currently active files only. File Initiation Year subfilter can show all initiation years or restrict to files initiated in one FY.",
      },
      {
        label: "Active + current FY closed",
        description: `Shows currently open files plus files closed during current FY ${currentFyLabel}. Cancelled files remain excluded.`,
      },
      {
        label: "FY Activity: specific FY",
        description:
          "Shows files initiated in that FY plus older files that remained active/continued in that FY or had activity in that FY. It is not only initiation year.",
      },
      {
        label: "File Initiation Year subfilter",
        description:
          "Narrows the already selected Global Filter by file initiation year. Example: Global Filter 2026-27 + Subfilter 2025-26 shows old files active in 2026-27 but initiated in 2025-26.",
      },
      {
        label: "Value Reports",
        description:
          "In active-file modes, allocation uses current FY allocation; intended, booked, committed, and S.O. values come from the selected files.",
      },
      {
        label: "Previous FY cash outgo",
        description:
          "Future-year payments do not alter previous-FY actual cash outgo. Previous-FY reports change only if dates/amounts/MER are backdated or edited into that FY.",
      },
    ],
  };
}

function getFinancialYearDateRangeLabel(financialYear: string | undefined) {
  const startYear = readFinancialYearStart(financialYear);
  if (!startYear) return "";
  return `01 Apr ${startYear} to 31 Mar ${startYear + 1}`;
}

function readFinancialYearStart(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}
