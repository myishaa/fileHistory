import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  FileText,
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
  Lock,
  Unlock,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  store,
  useActiveUser,
  useFileProcessingNotifications,
  useMessages,
  useSettings,
  fetchReportPreferences,
  saveReportPreferences,
} from "@/lib/files-store";
import {
  ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
  ALL_ACTIVE_FILES_YEAR,
  ALL_FILES_YEAR,
  displayFinancialYearLabel,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";
import { filterControlClass, filterLabelClass } from "@/lib/active-filter-style";
import { SearchableDropdown } from "@/components/searchable-dropdown";
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

const specificFyOlderFileRule =
  "An older file is included if it was still open on 1 April of the selected FY, even if it was formally closed later.";

function getAnomalyFilterQuery(userId: string, selectedYear: string, financialYear: string) {
  if (typeof window !== "undefined") {
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(`recordkeeper:anomaly-filter-scope:${userId}`) ?? "null",
      );
      if (saved?.selectedYear === selectedYear && typeof saved.query === "string") {
        return saved.query as string;
      }
    } catch {
      // Use the current default scope when saved Dashboard filters are unavailable.
    }
  }
  const params = new URLSearchParams({ selectedYear });
  const normalizedGlobalYear = normalizeFinancialYearLabel(selectedYear);
  const defaultFileYear =
    selectedYear === ALL_ACTIVE_FILES_YEAR ||
    selectedYear === ALL_FILES_YEAR ||
    selectedYear === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
      ? financialYear
      : normalizedGlobalYear || financialYear;
  if (defaultFileYear) params.set("fileYear", defaultFileYear);
  return params.toString();
}

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locationSearch = useRouterState({ select: (s) => s.location.search });
  const navigate = useNavigate();
  const settings = useSettings();
  const messages = useMessages();
  const fileProcessingNotifications = useFileProcessingNotifications();
  const activeUser = useActiveUser();
  const [anomalyWarningCount, setAnomalyWarningCount] = useState(0);
  const [anomalyWarningError, setAnomalyWarningError] = useState(false);
  const anomalyRequestId = useRef(0);
  const [ipAccessWarningCount, setIpAccessWarningCount] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [filterGuideOpen, setFilterGuideOpen] = useState(false);
  const [filterWarningSuppressed, setFilterWarningSuppressed] = useState(false);
  const [filterWarningPreferenceLoaded, setFilterWarningPreferenceLoaded] = useState(false);
  const [filterScopeRevision, setFilterScopeRevision] = useState(0);
  const isDark = settings.theme === "dark";
  const canManageAdminSettings = activeUser?.role === "admin";
  const canUpdateAppearance = Boolean(activeUser);
  const canSelectYear = Boolean(activeUser);
  const canViewUserSettings = Boolean(activeUser);
  const dashboardTab = typeof locationSearch.tab === "string" ? locationSearch.tab : undefined;
  const reportMode = typeof locationSearch.mode === "string" ? locationSearch.mode : undefined;
  const isFinanceSnapshotContext = pathname === "/dashboard" && dashboardTab === "finance1";
  const effectiveSelectedYear = isFinanceSnapshotContext
    ? normalizeFinancialYearLabel(settings.selectedYear) || settings.financialYear
    : settings.selectedYear;
  const globalFilterHelp = getGlobalFilterHelp(effectiveSelectedYear, settings.financialYear);
  const filterCombinationGuide = getFilterCombinationGuide(settings.financialYear);
  const recommendedFilterLabel = getRecommendedFilterLabel(
    pathname,
    dashboardTab,
    reportMode,
    settings.financialYear,
  );
  const recommendedGlobalFilterValue = getRecommendedGlobalFilterValue(
    pathname,
    dashboardTab,
    reportMode,
    settings.financialYear,
    effectiveSelectedYear,
  );
  const globalFilterActive = isGlobalFilterNonSuggested(
    pathname,
    dashboardTab,
    reportMode,
    effectiveSelectedYear,
    settings.financialYear,
  );
  const filterCombinationActive =
    globalFilterActive ||
    isSubfilterNonSuggested(
      pathname,
      dashboardTab,
      reportMode,
      settings.financialYear,
      activeUser?.id,
    );
  void filterScopeRevision;

  useEffect(() => {
    if (!activeUser) {
      setFilterWarningSuppressed(false);
      setFilterWarningPreferenceLoaded(false);
      return;
    }
    setFilterWarningPreferenceLoaded(false);
    if (activeUser.id.startsWith("viewer:")) {
      try {
        const stored = window.localStorage.getItem(
          `recordkeeper:filter-warning:${activeUser.id}`,
        );
        setFilterWarningSuppressed(stored === "suppressed");
      } catch {
        setFilterWarningSuppressed(false);
      }
      setFilterWarningPreferenceLoaded(true);
      return;
    }
    void fetchReportPreferences<{ suppressed?: boolean }>("globalFilterWarning")
      .then(({ preferences }) => setFilterWarningSuppressed(preferences.suppressed === true))
      .catch((error) => {
        console.error(error);
        setFilterWarningSuppressed(false);
      })
      .finally(() => setFilterWarningPreferenceLoaded(true));
  }, [activeUser?.id]);

  useEffect(() => {
    const refreshSubfilterScope = () => setFilterScopeRevision((revision) => revision + 1);
    window.addEventListener("recordkeeper:filter-scope-changed", refreshSubfilterScope);
    return () => window.removeEventListener("recordkeeper:filter-scope-changed", refreshSubfilterScope);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setFilterScopeRevision((revision) => revision + 1),
      100,
    );
    return () => window.clearTimeout(timeoutId);
  }, [activeUser?.id, dashboardTab, pathname, reportMode]);

  useEffect(() => {
    if (!filterWarningPreferenceLoaded) return;
    const timeoutId = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("recordkeeper:filter-warning-state", {
          detail: { active: filterCombinationActive && !filterWarningSuppressed },
        }),
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [filterCombinationActive, filterWarningPreferenceLoaded, filterWarningSuppressed]);

  const toggleFilterWarningSuppression = async () => {
    if (!activeUser) return;
    const nextSuppressed = !filterWarningSuppressed;
    setFilterWarningSuppressed(nextSuppressed);
    try {
      if (activeUser.id.startsWith("viewer:")) {
        window.localStorage.setItem(
          `recordkeeper:filter-warning:${activeUser.id}`,
          nextSuppressed ? "suppressed" : "visible",
        );
      } else {
        await saveReportPreferences("globalFilterWarning", { suppressed: nextSuppressed });
      }
    } catch (error) {
      setFilterWarningSuppressed(!nextSuppressed);
      window.alert(error instanceof Error ? error.message : "Could not save filter warning preference.");
    }
  };
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
  const displayedAnomalyWarningCount =
    anomalyWarningError && anomalyWarningCount === 0 ? 1 : anomalyWarningCount;
  const bellCount = messageWarningCount + displayedAnomalyWarningCount + fileProcessingWarningCount;
  const adminBellCount = bellCount + ipAccessWarningCount;
  const refreshAnomalyWarningCount = useCallback(() => {
    const requestId = ++anomalyRequestId.current;
    if (!activeUser) {
      setAnomalyWarningCount(0);
      setAnomalyWarningError(false);
      return;
    }
    const selectedYear = settings.selectedYear || settings.financialYear;
    const query = getAnomalyFilterQuery(activeUser.id, selectedYear, settings.financialYear);
    void store
      .countSuspectedAnomalies(query)
      .then((count) => {
        if (requestId !== anomalyRequestId.current) return;
        setAnomalyWarningCount(count);
        setAnomalyWarningError(false);
      })
      .catch((error) => {
        console.error(error);
        if (requestId !== anomalyRequestId.current) return;
        setAnomalyWarningError(true);
      });
  }, [activeUser, settings.financialYear, settings.selectedYear]);
  useEffect(() => {
    if (!activeUser) {
      setAnomalyWarningCount(0);
      setAnomalyWarningError(false);
      return;
    }
    let cancelled = false;
    const selectedYear = settings.selectedYear || settings.financialYear;
    const loadAnomalyCount = () => {
      const requestId = ++anomalyRequestId.current;
      const query = getAnomalyFilterQuery(activeUser.id, selectedYear, settings.financialYear);
      void store
        .countSuspectedAnomalies(query)
        .then((count) => {
          if (!cancelled && requestId === anomalyRequestId.current) {
            setAnomalyWarningCount(count);
            setAnomalyWarningError(false);
          }
        })
        .catch((error) => {
          console.error(error);
          if (!cancelled && requestId === anomalyRequestId.current) setAnomalyWarningError(true);
        });
    };
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === "recordkeeper:anomaly-data-updated") loadAnomalyCount();
    };
    loadAnomalyCount();
    const intervalId = window.setInterval(loadAnomalyCount, 60_000);
    window.addEventListener("focus", loadAnomalyCount);
    window.addEventListener("recordkeeper:anomaly-scope-changed", loadAnomalyCount);
    window.addEventListener("recordkeeper:anomaly-data-updated", loadAnomalyCount);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadAnomalyCount);
      window.removeEventListener("recordkeeper:anomaly-scope-changed", loadAnomalyCount);
      window.removeEventListener("recordkeeper:anomaly-data-updated", loadAnomalyCount);
      window.removeEventListener("storage", refreshFromStorage);
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
  const globalYearOptions = [
    ...(!isFinanceSnapshotContext
      ? [
          { value: ALL_FILES_YEAR, label: "All files" },
          { value: ALL_ACTIVE_FILES_YEAR, label: "All active files" },
          {
            value: ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
            label: "Active + current FY closed",
          },
        ]
      : []),
    ...yearOptions.map((year) => ({ value: year, label: displayFinancialYearLabel(year) })),
  ];
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

        <div className="flex w-full min-w-0 flex-wrap items-start gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap sm:items-center sm:gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setWarningsOpen((open) => {
                  if (!open) refreshAnomalyWarningCount();
                  return !open;
                });
              }}
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
                        {anomalyWarningError
                          ? "Could not refresh anomaly count"
                          : "Count follows Dashboard anomaly filters"}
                      </span>
                    </span>
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                      {anomalyWarningError && anomalyWarningCount === 0
                        ? "!"
                        : anomalyWarningCount}
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
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <div className="flex items-center gap-1.5">
              <label
                className={filterControlClass(
                  globalFilterActive,
                  "flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1",
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
                <SearchableDropdown
                  data-testid="global-year-select"
                  value={effectiveSelectedYear}
                  options={[]}
                  optionItems={globalYearOptions}
                  deferChangeUntilSelect
                  allowCustomValue={false}
                  showClearOption={false}
                  onChange={(selectedValue) => {
                    const selectedYear =
                      selectedValue || recommendedGlobalFilterValue;
                    store.updateSessionSelectedYear(selectedYear);
                    if (pathname === "/search" && typeof locationSearch.selectedYear === "string") {
                      navigate({
                        to: "/search",
                        search: (previous) => ({ ...previous, selectedYear }),
                      });
                    }
                  }}
                  disabled={!canSelectYear}
                  className={
                    "h-6 min-w-0 max-w-full border-0 bg-transparent px-0 text-sm font-semibold outline-none focus:ring-0 " +
                    (globalFilterActive ? "text-destructive" : "text-foreground")
                  }
                >
                </SearchableDropdown>
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
            <div className="flex min-w-0 items-center gap-1 pl-1">
              <div
                className="flex max-w-[24rem] min-w-0 items-center gap-1 truncate text-[11px] font-semibold leading-none text-foreground"
                title={`Recommended: ${recommendedFilterLabel.activityYear} + ${recommendedFilterLabel.fileYear}`}
              >
                <span>Recommended:</span>
                <span className="truncate">{recommendedFilterLabel.activityYear}</span>
                <span>+</span>
                <span className="truncate">{recommendedFilterLabel.fileYear}</span>
              </div>
              <button
                type="button"
                onClick={() => void toggleFilterWarningSuppression()}
                disabled={!filterWarningPreferenceLoaded}
                aria-pressed={filterWarningSuppressed}
                title={
                  filterWarningSuppressed
                    ? "Unlock to show the screen-wide warning for non-recommended filters"
                    : "Lock to suppress the screen-wide warning; filter highlighting remains"
                }
                aria-label={
                  filterWarningSuppressed
                    ? "Unlock screen-wide filter warning"
                    : "Lock screen-wide filter warning"
                }
                className={
                  "grid size-7 shrink-0 place-items-center rounded border disabled:cursor-wait disabled:opacity-50 " +
                  (filterWarningSuppressed
                    ? "border-border bg-card text-muted-foreground hover:bg-accent"
                    : "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20")
                }
              >
                {filterWarningSuppressed ? (
                  <Lock className="size-3.5" />
                ) : (
                  <Unlock className="size-3.5" />
                )}
              </button>
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
      {filterCombinationActive && !filterWarningSuppressed ? (
        <div className="border-t border-destructive/40 bg-destructive/15 px-4 py-2 text-center text-sm font-semibold text-destructive">
          Caution: Global Filter or File Initiation Year differs from this page’s recommended combination. Review the selected scope before relying on these results.
        </div>
      ) : null}
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
  const currentStartYear = readFinancialYearStart(currentFinancialYear);
  const previousFyLabel =
    currentStartYear !== undefined
      ? `${currentStartYear - 1}-${String(currentStartYear % 100).padStart(2, "0")}`
      : "previous FY";
  const previousFyStartLabel =
    currentStartYear !== undefined ? String(currentStartYear - 1) : "previous FY start";
  const exportPdf = () => {
    const tables: ExportTable[] = [
      {
        title: "How Global Filter Works",
        headers: ["Term", "Meaning", "Examples"],
        rows: [
          [
            "Specific FY",
            "Files started in that FY appear, along with older files that were still open when it began. Cancelled files may also appear.",
            `For ${displayFinancialYearLabel(currentFinancialYear)}: files started in that FY are included. ${specificFyOlderFileRule} Files closed during that FY are included. Active + current FY closed excludes cancelled/all-S.O.-cancelled files.`,
          ],
          [
            "File Initiation Year",
            "The FY when the file started. It narrows the Global Filter to files from that year.",
          `Global Filter ${displayFinancialYearLabel(currentFinancialYear)} + Subfilter 2025-26 shows files started in 2025-26 that also meet the selected FY rules.`,
          ],
        ],
        columnWidths: [90, 210, 280],
      },
      {
        title: "Global Filter Inclusion Rules",
        headers: [
          "Filter option",
          "Basic rule",
          "Old active file",
          "File closed in selected/current FY",
          "File closed before selected/current FY",
          "Cancelled demand / all S.O.s cancelled",
        ],
        rows: [
          [
            "Specific FY",
            "Files connected with the selected FY.",
            specificFyOlderFileRule,
            "Included.",
            "Excluded, unless specifically marked active in that FY.",
            "Can be included when the file belongs to that FY; panels may still exclude cancelled rows by their own rules.",
          ],
          [
            "All files",
            "Full accessible database.",
            "Included.",
            "Included.",
            "Included.",
            "Included in full database, but many working/value panels still exclude cancelled rows by their own rules.",
          ],
          [
            "All active files",
            "Active files today.",
            "Included if still active today.",
            "Excluded.",
            "Excluded.",
            "Excluded.",
          ],
          [
            "Active + current FY closed",
            "Active files today plus files closed in current FY.",
            "Included if still active today.",
            "Included.",
            "Excluded.",
            "Excluded. This is the main difference from Specific FY.",
          ],
        ],
        columnWidths: [95, 105, 100, 115, 125, 170],
      },
      {
        title: "Filter Examples",
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
              <DialogTitle className="text-lg">Filter Guide</DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                Recommended Global Filter and Subfilter combinations.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
              title="Export filter guide as PDF"
              aria-label="Export filter guide PDF"
            >
              <FileText className="size-3.5" />
              PDF
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
              A specific FY includes files started in that year and older files that were still
              open on 1 April. Active + current FY closed shows today's active files plus files
              closed this FY; it excludes cancelled demands and files with only cancelled S.O.s.
            </p>
	            <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
	              <div className="rounded-md border border-border bg-card px-3 py-2">
	                <div className="font-semibold text-foreground">
	                  Example: Global Filter {displayFinancialYearLabel(currentFinancialYear)}
	                </div>
	                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
	                  <li>File started in FY {displayFinancialYearLabel(currentFinancialYear)}.</li>
	                  <li>{specificFyOlderFileRule}</li>
	                  <li>File was closed during FY {displayFinancialYearLabel(currentFinancialYear)}.</li>
	                  <li>Event-date reports still use their own date rules.</li>
	                </ul>
	              </div>
	              <div className="rounded-md border border-border bg-card px-3 py-2">
	                <div className="font-semibold text-foreground">
	                  Example: Global Filter {previousFyLabel}
	                </div>
	                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
	                  <li>File started in FY {previousFyLabel}.</li>
	                  <li>{specificFyOlderFileRule}</li>
	                  <li>File closed during FY {previousFyLabel}.</li>
	                  <li>Files closed before FY {previousFyLabel} are excluded.</li>
	                </ul>
	              </div>
	              <div className="rounded-md border border-border bg-card px-3 py-2">
                <div className="font-semibold text-foreground">Example: File Initiation Year</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>File received/started in FY 2025-26.</li>
                  <li>
                    With Global Filter 2026-27, Subfilter 2025-26 shows only those 2025-26 files
                    that are included in the 2026-27 view.
                  </li>
                  <li>Choosing All file years keeps every initiation year eligible.</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mb-4 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th
                    className="border-b border-border px-3 py-2 text-left text-sm font-bold text-foreground"
                    colSpan={6}
                  >
                    Global Filter Inclusion Rules
                  </th>
                </tr>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Filter Option
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Basic Rule
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Old Active File
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    File Closed in Selected/Current FY
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    File Closed Before Selected/Current FY
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left font-semibold">
                    Cancelled Demand / All S.O.s Cancelled
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
	                  {
	                    filter: "Specific FY",
	                    meaning: "Files connected with the selected FY.",
	                    older: specificFyOlderFileRule,
	                    closed: "Included.",
	                    oldOpen: "Excluded, unless specifically marked active in that FY.",
	                    cancelled:
	                      "Can be included when the file belongs to that FY; panels may still exclude cancelled rows by their own rules.",
	                  },
	                  {
	                    filter: "All files",
	                    meaning: "Full accessible database.",
	                    older: "Included.",
	                    closed: "Included.",
	                    oldOpen: "Included.",
	                    cancelled:
	                      "Included in full database, but many working/value panels still exclude cancelled rows by their own rules.",
	                  },
	                  {
	                    filter: "All active files",
	                    meaning: "Active files today.",
	                    older: "Included if still active today.",
	                    closed: "Excluded.",
	                    oldOpen: "Excluded.",
	                    cancelled: "Excluded.",
	                  },
	                  {
	                    filter: "Active + current FY closed",
	                    meaning: "Active files today plus files closed in current FY.",
	                    older: "Included if still active today.",
	                    closed: "Included.",
	                    oldOpen: "Excluded.",
	                    cancelled: "Excluded. This is the main difference from Specific FY.",
	                  },
	                ].map((row) => (
                  <tr key={row.filter} className="border-t border-border">
                    <td className="px-3 py-2 align-top font-semibold">{row.filter}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.meaning}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{row.older}</td>
	                    <td className="px-3 py-2 align-top text-muted-foreground">{row.closed}</td>
	                    <td className="px-3 py-2 align-top text-muted-foreground">{row.oldOpen}</td>
	                    <td className="px-3 py-2 align-top text-muted-foreground">{row.cancelled}</td>
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
                    Filter Examples
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
  const currentStartYear = readFinancialYearStart(currentFinancialYear);
  const previousFyLabel =
    currentStartYear !== undefined
      ? `${currentStartYear - 1}-${String(currentStartYear % 100).padStart(2, "0")}`
      : "previous FY";
  const previousFyStartLabel =
    currentStartYear !== undefined ? String(currentStartYear - 1) : "previous FY start";
  const softwareDefault = "Active + current FY closed";
  const currentFy = `Current FY ${currentFyLabel}`;
  const allFileYears = "All file years";

  return {
    meaningRows: [
      {
        filter: `Specific FY, e.g. ${currentFyLabel}`,
        useWhen: "Review files connected with one FY.",
        shows:
          `Files started in that FY, plus older files that were still open on 1 April. ${specificFyOlderFileRule} Files closed during that FY are also included.`,
        examples: [
          `File started in ${currentFyLabel}: included.`,
          `Older file still open on 01 Apr ${currentStartYear ?? ""}, then formally closed in a later FY: included in ${currentFyLabel}.`,
          `File closed during ${currentFyLabel}: included.`,
          `If ${previousFyLabel} is selected, the same rule applies using 01 Apr ${previousFyStartLabel}.`,
          "Event-date reports may further restrict rows by their own event date.",
        ],
      },
      {
        filter: "All files",
        useWhen: "Review the full accessible database.",
        shows: "All accessible files, irrespective of FY or open/closed status.",
        examples: [
          "Old open file: included.",
          "Old closed file: included.",
          "Cancelled file: included here, unless the selected panel excludes it.",
          "Cumulative review across the accessible database.",
        ],
      },
      {
        filter: "All active files",
        useWhen: "Review active files only.",
        shows: "Active, non-cancelled files across all initiation years.",
        examples: [
          "Old file still active today: included.",
          "File closed today or earlier: excluded.",
          "Cancelled file: excluded.",
          "Today's live list of active files.",
        ],
      },
      {
        filter: "Active + current FY closed",
        useWhen: "Review active files plus files closed this FY.",
        shows: `Active, non-cancelled files plus files closed during ${currentFyLabel}.`,
        examples: [
          "Old file still active today: included.",
          `File closed during ${currentFyLabel}: included.`,
          `File closed before ${currentFyLabel}: excluded.`,
          "Cancelled file: excluded.",
        ],
      },
      {
        filter: "File Initiation Year subfilter",
        useWhen: "Select files started in one FY.",
        shows: "Only files started in the selected FY remain from the Global Filter results.",
        examples: [
          `Global Filter ${currentFyLabel} + Subfilter 2025-26: files started in 2025-26 that also meet the ${currentFyLabel} rules.`,
          `Global Filter ${currentFyLabel} + All file years: all initiation years remain eligible.`,
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
        note: "Search preserves the filters and source details from the originating view.",
        examples: [
          "Clicking Payment Pending opens the files behind that count.",
          "Opening from Pre-bid Completed FY 2026-27 should keep that FY and filter breadcrumb in Search.",
          "Manual Search can use any user-selected global/subfilter combination.",
        ],
      },
      {
	        page: "Status-1",
	        activityYear: softwareDefault,
	        fileInitiationYear: allFileYears,
	        useFor: "Day-to-day current monitoring.",
        note: "Active files and files closed this FY appear. Cancelled demands and files with only cancelled S.O.s are excluded.",
        examples: [
          "Best starting point for today's pending and recently completed work.",
          "Files still in progress appear alongside files closed during the current FY.",
          "The standard view supports day-to-day workflow monitoring.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-2",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
	        useFor: "Current operational status view.",
        note: "Status-2 includes the same files as Status-1.",
        examples: [
          "Check the stage each file is currently waiting at.",
          "See which stages are pending across divisions.",
          "Keeps the view aligned with Status-1 for easier comparison.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-3",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
	        useFor: "Current milestone/status breakup.",
        note: "Status-3 includes the same files as Status-1; cancelled demands and files with only cancelled S.O.s are excluded.",
        examples: [
          "Status-3 presents Status-1 information in a compact table.",
          "Compare S.O., delivery, payment, and related stage counts in one table.",
          "Status-3 keeps the same file selection as Status-1.",
        ],
        emphasis: "software",
      },
      {
        page: "Status-4",
        activityYear: softwareDefault,
        fileInitiationYear: allFileYears,
	        useFor: "Pre-SO Live Status.",
        note: "The pre-S.O. workflow includes active files and files closed this FY. Cancelled demands are excluded.",
        examples: [
          "Pre-S.O. stages cover files before an S.O. is placed.",
          "Follow demand, approval, vetting, bidding, and other steps before an S.O. is placed.",
          "Not meant for payment, delivery, or post-S.O. monitoring.",
        ],
        emphasis: "software",
      },
      {
        page: "Analytics",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
	        useFor: "FY activity such as S.O., CNC, TCEC, pre-bid, BG expiry, delivery, and inflow.",
        note: "Files connected with that FY are included. A panel may still exclude cancelled cases from its own count.",
        examples: [
          "Older files appear when their activity took place during the selected FY.",
          "Review FY-wise S.O., meeting, BG, delivery, pending-payment, and workload results.",
          "Select a specific Subfilter to study one initiation-year batch.",
        ],
        emphasis: "reports",
      },
      {
        page: "Finance",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
        useFor: "Payments made in the current FY, older unpaid amounts, and firm-type totals.",
	        note: "FY finance view; use Status pages for the operational non-cancelled set.",
        examples: [
          "Review current-FY payments and unpaid amounts across files started in any FY.",
          "Review payments, earlier unpaid amounts, cleared carry-forward, and firm-type totals.",
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
          "Review all files started in one FY, including their recorded history.",
          "Compare FY-end figures with payments and unpaid amounts recorded to date, by File Type.",
          "Running FY figures stay provisional until the FY is complete.",
        ],
      },
      {
        page: "Reports",
        activityYear: currentFy,
        fileInitiationYear: allFileYears,
	        useFor: "FY reports and event-date based report rows.",
	        note: "FY/event-date view; individual reports may exclude cancelled rows by their own rules.",
        examples: [
          "Report rows are grouped by each report's event date within the selected FY.",
          "Review month-wise S.O., delivery, BG expiry, and meeting schedules.",
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
          "Review payments made and expected during the selected FY.",
          "Review month-wise payments, pending bills, due payments, and cash-out plans.",
          "Older files can appear when their payment or cash-out event belongs to the selected FY.",
        ],
	        emphasis: "reports",
	      },
	      {
	        page: "Pre-S.O. expected cash outgo",
	        activityYear: "All active files",
	        fileInitiationYear: allFileYears,
	        useFor: "Live planning for files where S.O. is not yet placed.",
	        note: "Fixed live-planning view; closed/cancelled files should not drive expected cash outgo.",
	        examples: [
	          "Only active files without a placed S.O. appear here.",
          "Plan tentative S.O. dates, payment dates, and expected monthly cash outgo.",
          "Specific FY is not used as the main scope in this live-planning view.",
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
          "Quick Entry supports fast entry, barcode lookup, and direct file opening.",
          "Opening a file here does not change Dashboard or Reports filters.",
        ],
      },
      {
        page: "Old-file performance",
        activityYear: currentFy,
        fileInitiationYear: "Specific earlier FY",
        useFor: "Study how older files performed during the current FY.",
        note: "Example: Global Filter 2026-27 + Subfilter 2025-26.",
        examples: [
          "An older initiation-year group can be reviewed for its activity during a later FY.",
          "Example question: how did files started in 2025-26 progress during 2026-27?",
          "Not suitable for overall FY reporting because other initiation years are intentionally excluded.",
        ],
      },
      {
        page: "Full database cumulative view",
        activityYear: "All files",
        fileInitiationYear: "Entire database / All file years",
        useFor: "Cumulative Finance totals across the accessible database.",
        note: "Cumulative Finance totals do not represent activity in one selected FY.",
        examples: [
          "Review cumulative Finance totals for the accessible database.",
          "Review cumulative Finance values and the full accessible database.",
          "Not suitable for selected-FY activity analysis.",
        ],
      },
    ] satisfies FilterCombinationGuideRow[],
    notes: [
      "Global Filter chooses which files are included. File Initiation Year can then narrow that list.",
      "Do not auto-switch filters when entering Finance, Reports, Search, or Quick Entry.",
      "For current day-to-day operations, use the recommended combination shown below the Global Filter.",
      `For Finance and Reports, the usual default is Global Filter = Current FY ${currentFyLabel} with Subfilter = All file years.`,
      "FY Snapshot offers FY options in Global Filter and locks Subfilter to the same FY.",
      "Specific File Initiation Year is for studying files started in one FY.",
    ],
  };
}

function getRecommendedFilterLabel(
  pathname: string,
  dashboardTab: string | undefined,
  reportMode: string | undefined,
  currentFinancialYear: string,
) {
  const currentFyLabel = `Current FY ${displayFinancialYearLabel(currentFinancialYear)}`;
  if (pathname === "/quick-entry") {
    return {
      activityYear: "No change",
      fileYear: "No change",
    };
  }
  if (pathname === "/search") {
    return {
      activityYear: "Active + current FY closed",
      fileYear: "User's current selection",
    };
  }
  if (pathname === "/reports") {
    if (reportMode === "preSoExpectedCashOutgo") {
      return {
        activityYear: "All active files",
        fileYear: "All file years",
      };
    }
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
        activityYear: "Select any FY",
        fileYear: "Locked to same FY",
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

function getRecommendedGlobalFilterValue(
  pathname: string,
  dashboardTab: string | undefined,
  reportMode: string | undefined,
  currentFinancialYear: string,
  currentSelectedYear: string,
) {
  if (pathname === "/search") return ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
  if (pathname === "/reports") {
    return reportMode === "preSoExpectedCashOutgo" ? ALL_ACTIVE_FILES_YEAR : currentFinancialYear;
  }
  if (pathname === "/dashboard") {
    if (dashboardTab === "finance1" || dashboardTab === "finance" || dashboardTab === "analytics") {
      return currentFinancialYear;
    }
    return ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
  }
  return currentSelectedYear || ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function isGlobalFilterNonSuggested(
  pathname: string,
  dashboardTab: string | undefined,
  reportMode: string | undefined,
  selectedYear: string | undefined,
  currentFinancialYear: string,
) {
  if (pathname === "/reports") {
    if (reportMode === "preSoExpectedCashOutgo") return selectedYear !== ALL_ACTIVE_FILES_YEAR;
    return selectedYear !== currentFinancialYear;
  }
  if (pathname !== "/dashboard") return false;
  if (dashboardTab === "finance1") return false;
  if (dashboardTab === "finance" || dashboardTab === "analytics") {
    return selectedYear !== currentFinancialYear;
  }
  return selectedYear !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function isSubfilterNonSuggested(
  pathname: string,
  dashboardTab: string | undefined,
  reportMode: string | undefined,
  currentFinancialYear: string,
  userId: string | undefined,
) {
  if (pathname === "/search" || pathname === "/quick-entry" || pathname === "/add") {
    return false;
  }
  if (pathname === "/dashboard" && dashboardTab === "finance1") return false;
  if (pathname === "/reports" && reportMode === "preSoExpectedCashOutgo") return false;
  if (pathname !== "/dashboard" && pathname !== "/reports") return false;

  const key = `recordkeeper:file-year-filter:${userId ?? "anonymous"}`;
  let selectedFileYear = currentFinancialYear;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (typeof saved?.year === "string") selectedFileYear = saved.year;
  } catch {
    // Treat an unavailable saved subfilter as its page default.
  }

  const recommendedFileYear = "all";
  return selectedFileYear !== recommendedFileYear;
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
	      ? "All accessible files are included. File Initiation Year can restrict results by start FY."
	      : normalizedSelected === ALL_ACTIVE_FILES_YEAR
	        ? "Active, non-cancelled files are included. File Initiation Year can restrict results by start FY."
	        : normalizedSelected === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
	          ? `Shows active files plus files closed during current FY ${currentFyLabel}${currentFyRange ? ` (${currentFyRange})` : ""}. Cancelled files remain excluded.`
	          : `Shows files started in FY ${selectedFyLabel}, plus older files that were still open on 1 April. ${specificFyOlderFileRule} Files closed during that FY are also included.`;

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
	        filePool: `Files started in that FY; ${specificFyOlderFileRule}`,
	        reportFy: `Same selected FY, e.g. ${selectedFyLabel}`,
	      },
    ],
    options: [
      {
        label: "Finance default",
        description: `Global Filter = current FY ${currentFyLabel}; Subfilter = All file years. Use this for payments made in the current FY, earlier unpaid amounts, and firm-type totals across all initiation years.`,
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
        label: "Specific FY vs operational set",
        description:
          "A specific FY can include cancelled demands and files whose S.O.s were all cancelled. Active + current FY closed excludes those files.",
      },
      {
        label: "All files",
        description:
          "All accessible files are included, whether active, closed, or cancelled. Choose File Initiation Year = Entire database for no start-year restriction, or select one FY to limit results to files started that year.",
      },
      {
        label: "All active files",
        description:
          "Only currently active files are included. File Initiation Year can include every start year or limit results to one FY.",
      },
      {
        label: "Active + current FY closed",
	        description: `Shows currently active files plus files closed during current FY ${currentFyLabel}. Cancelled files remain excluded.`,
      },
	      {
	        label: "FY Activity: specific FY",
	        description:
	          `Shows files started in that FY. ${specificFyOlderFileRule} It is not only the initiation year.`,
	      },
	      {
	        label: "File Initiation Year subfilter",
	        description:
	          "Narrows the Global Filter by the year the file started. Example: Global Filter 2026-27 + Subfilter 2025-26 shows 2025-26 files included in the 2026-27 view.",
	      },
      {
        label: "Value Reports",
        description:
          "In active-file modes, allocation uses the current FY budget. Intended, booked, committed, and S.O. values come from the selected files.",
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
