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
import { HelperContent } from "@/components/helper-content";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { downloadBackendExport, type ExportTable } from "@/lib/export-download";
import {
  clearPageSubfilterLocks,
  readFilterCombinationLock,
  writeFilterCombinationLock,
  type FilterCombinationLock,
} from "@/lib/filter-combination-lock";

const nav = [
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/quick-entry", label: "Quick Entry", icon: ScanLine },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const specificFyOlderFileRule =
  "Active files carried forward from earlier years remain included, even if closed later.";

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
  const activeUserId = activeUser?.id;
  const [anomalyWarningCount, setAnomalyWarningCount] = useState(0);
  const [anomalyWarningError, setAnomalyWarningError] = useState(false);
  const anomalyRequestId = useRef(0);
  const [ipAccessWarningCount, setIpAccessWarningCount] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [filterGuideOpen, setFilterGuideOpen] = useState(false);
  const [filterLockDialogOpen, setFilterLockDialogOpen] = useState(false);
  const [savedFilterCombination, setSavedFilterCombination] = useState<FilterCombinationLock>();
  const [filterCombinationLocked, setFilterCombinationLocked] = useState(false);
  const [filterWarningSuppressed, setFilterWarningSuppressed] = useState(false);
  const [filterWarningPreferenceLoaded, setFilterWarningPreferenceLoaded] = useState(false);
  const [filterScopeRevision, setFilterScopeRevision] = useState(0);
  const isDark = settings.theme === "dark";
  const canManageAdminSettings = activeUser?.role === "admin";
  const canUpdateAppearance = Boolean(activeUser);
  const canSelectYear = Boolean(activeUser) && pathname !== "/quick-entry";
  const canViewUserSettings = Boolean(activeUser);
  const dashboardTab = typeof locationSearch.tab === "string" ? locationSearch.tab : undefined;
  const analyticsPanel =
    typeof locationSearch.analyticsPanel === "string" ? locationSearch.analyticsPanel : undefined;
  const reportMode = typeof locationSearch.mode === "string" ? locationSearch.mode : undefined;
  const isFinanceSnapshotContext =
    pathname === "/dashboard" && (dashboardTab === "snapshot" || dashboardTab === "finance1");
  const isFinanceActivityContext = pathname === "/dashboard" && dashboardTab === "fyActivity";
  const isSpecificFinanceYearContext = isFinanceSnapshotContext || isFinanceActivityContext;
  const effectiveSelectedYear = isSpecificFinanceYearContext
    ? normalizeFinancialYearLabel(settings.selectedYear) || settings.financialYear
    : settings.selectedYear;
  const globalFilterHelp = getGlobalFilterHelp(effectiveSelectedYear, settings.financialYear);
  const filterGuideSections = getSectionFilterGuide(settings.financialYear);
  const recommendedFilterLabel = getRecommendedFilterLabel(
    pathname,
    dashboardTab,
    analyticsPanel,
    reportMode,
    settings.financialYear,
  );
  const recommendedGlobalFilterValue = getRecommendedGlobalFilterValue(
    pathname,
    dashboardTab,
    analyticsPanel,
    reportMode,
    settings.financialYear,
    effectiveSelectedYear,
  );
  const selectedGlobalFilterLabel = getGlobalFilterDisplayLabel(effectiveSelectedYear);
  const selectedFileYearLabel = useMemo(
    () =>
      getSelectedFileYearLabel(
        pathname,
        dashboardTab,
        activeUser?.id,
        effectiveSelectedYear,
        recommendedFilterLabel.fileYear,
      ),
    [
      activeUser?.id,
      dashboardTab,
      effectiveSelectedYear,
      filterScopeRevision,
      pathname,
      recommendedFilterLabel.fileYear,
    ],
  );
  const globalFilterActive = isGlobalFilterNonSuggested(
    pathname,
    dashboardTab,
    analyticsPanel,
    reportMode,
    effectiveSelectedYear,
    settings.financialYear,
  );
  const filterCombinationActive =
    globalFilterActive ||
    isSubfilterNonSuggested(
      pathname,
      dashboardTab,
      analyticsPanel,
      reportMode,
      settings.financialYear,
      effectiveSelectedYear,
      activeUser?.id,
    );
  void filterScopeRevision;

  useEffect(() => {
    if (!activeUserId) {
      setSavedFilterCombination(undefined);
      setFilterCombinationLocked(false);
      return;
    }
    const localLock = readFilterCombinationLock(activeUserId);
    setSavedFilterCombination(localLock);
    setFilterCombinationLocked(Boolean(localLock));
    if (activeUserId.startsWith("viewer:")) return;
    void fetchReportPreferences<Partial<FilterCombinationLock> & { locked?: boolean }>(
      "filterCombinationLock",
    )
      .then(({ preferences }) => {
        const lock =
          preferences.locked === true &&
          typeof preferences.globalYear === "string" &&
          typeof preferences.fileYear === "string"
            ? ({
                locked: true,
                globalYear: preferences.globalYear,
                fileYear: preferences.fileYear,
              } satisfies FilterCombinationLock)
            : undefined;
        if (lock) clearPageSubfilterLocks(activeUserId);
        writeFilterCombinationLock(activeUserId, lock);
        setSavedFilterCombination(lock);
        setFilterCombinationLocked(Boolean(lock));
      })
      .catch((error) => console.error("Could not load saved filter combination", error));
  }, [activeUserId]);

  useEffect(() => {
    if (!activeUserId) return;
    const syncLock = () => {
      const lock = readFilterCombinationLock(activeUserId);
      setSavedFilterCombination(lock);
      setFilterCombinationLocked(Boolean(lock));
    };
    window.addEventListener("recordkeeper:filter-combination-lock-changed", syncLock);
    return () =>
      window.removeEventListener("recordkeeper:filter-combination-lock-changed", syncLock);
  }, [activeUserId]);

  useEffect(() => {
    if (!savedFilterCombination || pathname === "/quick-entry" || pathname === "/add") return;
    if (
      (isSpecificFinanceYearContext &&
        !normalizeFinancialYearLabel(savedFilterCombination.globalYear)) ||
      (pathname === "/reports" &&
        reportMode === "preSoExpectedCashOutgo" &&
        savedFilterCombination.globalYear !== ALL_ACTIVE_FILES_YEAR)
    ) return;
    store.updateSessionSelectedYear(savedFilterCombination.globalYear);
    if (pathname !== "/dashboard" && pathname !== "/reports") return;
    if (pathname === "/reports" && reportMode === "preSoExpectedCashOutgo") return;
    const suffix = pathname === "/dashboard" && dashboardTab === "fyActivity" ? ":fy-activity" : "";
    const fileYear =
      pathname === "/dashboard" && (dashboardTab === "snapshot" || dashboardTab === "finance1")
        ? savedFilterCombination.globalYear
        : savedFilterCombination.fileYear;
    window.sessionStorage.setItem(
      `recordkeeper:file-year-filter:${activeUser?.id ?? "anonymous"}${suffix}`,
      JSON.stringify({ year: fileYear }),
    );
    window.dispatchEvent(new Event("recordkeeper:filter-scope-changed"));
  }, [activeUser?.id, dashboardTab, isSpecificFinanceYearContext, pathname, reportMode, savedFilterCombination]);

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
        noticeBoardView: undefined,
        boardMetric: undefined,
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
    ...(!isSpecificFinanceYearContext
      ? [
          {
            value: ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
            label: "Active + current FY closed",
          },
          { value: ALL_ACTIVE_FILES_YEAR, label: "All active files" },
          { value: ALL_FILES_YEAR, label: "All files" },
        ]
      : []),
    ...yearOptions.map((year) => ({ value: year, label: displayFinancialYearLabel(year) })),
  ];
  useEffect(() => {
    if (!isSpecificFinanceYearContext) return;
    const normalizedSelectedYear = normalizeFinancialYearLabel(settings.selectedYear);
    const nextYear =
      normalizedSelectedYear && yearOptions.includes(normalizedSelectedYear)
        ? normalizedSelectedYear
        : settings.financialYear || yearOptions[0];
    if (nextYear && settings.selectedYear !== nextYear) {
      store.updateSessionSelectedYear(nextYear);
    }
  }, [isSpecificFinanceYearContext, settings.financialYear, settings.selectedYear, yearOptions]);

  const lockCurrentFilterCombination = async () => {
    if (!activeUser) return;
    const nextLock: FilterCombinationLock = {
      locked: true,
      globalYear: effectiveSelectedYear,
      fileYear: getSelectedFileYearValue(
        pathname,
        dashboardTab,
        activeUser.id,
        effectiveSelectedYear,
        recommendedFilterLabel.fileYear,
      ),
    };
    try {
      if (!activeUser.id.startsWith("viewer:")) {
        await saveReportPreferences("filterCombinationLock", nextLock);
      }
      clearPageSubfilterLocks(activeUser.id);
      writeFilterCombinationLock(activeUser.id, nextLock);
      setSavedFilterCombination(nextLock);
      setFilterCombinationLocked(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not save the filter combination.");
    }
  };

  const unlockFilterCombination = async () => {
    if (!activeUser) return;
    try {
      if (!activeUser.id.startsWith("viewer:")) {
        await saveReportPreferences("filterCombinationLock", { locked: false });
      }
      clearPageSubfilterLocks(activeUser.id);
      writeFilterCombinationLock(activeUser.id, undefined);
      setSavedFilterCombination(undefined);
      setFilterCombinationLocked(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not unlock the filter combination.");
    }
  };

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
      <div className="min-h-14 px-4 lg:px-6 pt-2.5 pb-6 flex flex-wrap items-center gap-3">
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
          <div className="flex w-full min-w-0 flex-col gap-1 sm:relative sm:top-4 sm:w-auto">
            <div className="flex items-center gap-1.5">
              <label
                title={
                  pathname === "/quick-entry"
                    ? "Global Filter is unavailable on Quick Entry"
                    : undefined
                }
                className={
                  filterControlClass(
                    globalFilterActive,
                    "flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1",
                  ) + (canSelectYear ? "" : " cursor-not-allowed opacity-60")
                }
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
                    "shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground",
                  )}
                >
                  Global Filter
                </span>
                <div className="w-48 min-w-48 shrink-0">
                  <SearchableDropdown
                    data-testid="global-year-select"
                    value={effectiveSelectedYear}
                    options={[]}
                    optionItems={globalYearOptions}
                    preserveOptionOrder
                    clearValue={recommendedGlobalFilterValue}
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
                    disabled={!canSelectYear || filterCombinationLocked}
                    className={
                      "h-6 min-w-0 max-w-full truncate border-0 bg-transparent px-0 text-sm font-semibold outline-none focus:ring-0 " +
                      (globalFilterActive ? "text-destructive" : "text-foreground")
                    }
                  />
                </div>
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
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        if (filterCombinationLocked) {
                          void unlockFilterCombination();
                        } else {
                          setFilterLockDialogOpen(true);
                        }
                      }}
                      aria-pressed={filterCombinationLocked}
                      aria-label={filterCombinationLocked ? "Unlock filters" : "Lock filters"}
                      className={
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium " +
                        (filterCombinationLocked
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border bg-card text-foreground hover:bg-accent")
                      }
                    >
                      {filterCombinationLocked ? (
                        <>
                          <Lock className="size-3.5" />
                          Unlock filters
                        </>
                      ) : (
                        <>
                          <Unlock className="size-3.5" />
                          Lock filters
                        </>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] border border-border bg-background text-foreground"
                  >
                    <HelperContent
                      lines={[
                        filterCombinationLocked
                          ? "This combination is saved for your user account and stays locked across pages and future sessions. Unlock before changing it."
                          : "Save the current Global Filter and Subfilter for your user account. The lock persists across pages and future sessions until you unlock it.",
                      ]}
                    />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex min-w-0 items-center gap-1 pl-1">
              <div
                className="flex max-w-[24rem] min-w-0 items-center gap-1 truncate text-[11px] font-semibold leading-none text-foreground"
                title={`Recommended: ${recommendedFilterLabel.activityYear}${
                  recommendedFilterLabel.fileYear ? ` + ${recommendedFilterLabel.fileYear}` : ""
                }`}
              >
                <span>Recommended:</span>
                <span className="truncate">{recommendedFilterLabel.activityYear}</span>
                {recommendedFilterLabel.fileYear ? (
                  <>
                    <span>+</span>
                    <span className="truncate">{recommendedFilterLabel.fileYear}</span>
                  </>
                ) : null}
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
      <Dialog open={filterLockDialogOpen} onOpenChange={setFilterLockDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lock filter combination</DialogTitle>
            <DialogDescription>
              Keep this pair selected across pages that use both filters. Fixed-scope pages keep their required filters. Unlock before changing the saved pair.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 divide-y divide-border rounded-md border border-border">
            <div className="flex items-start justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">Global Filter</span>
              <span className="text-right text-sm font-medium text-foreground">
                {selectedGlobalFilterLabel}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">Subfilter</span>
              <span className="text-right text-sm font-medium text-foreground">
                {selectedFileYearLabel}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFilterLockDialogOpen(false)}
              className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void lockCurrentFilterCombination();
                setFilterLockDialogOpen(false);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Lock className="size-4" />
              Save &amp; Lock
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <SectionFilterGuideDialog
        open={filterGuideOpen}
        onOpenChange={setFilterGuideOpen}
        currentTitle={globalFilterHelp.title}
        currentDescription={globalFilterHelp.description}
        sections={filterGuideSections}
      />
    </header>
  );
}

type FilterGuideSection = {
  key: string;
  label: string;
  globalFilter: string;
  subfilter: string;
  fileScope: string;
  activityYear: string;
  examples: string[];
};

type FilterGuideCombination = {
  globalFilter: string;
  subfilter: string;
  files: string;
  example: string;
};

type FilterGuideOption = {
  value: string;
  label: string;
  explanation: string;
};

function getFilterGuideOptions(sectionKey: string): FilterGuideOption[] {
  const make = (options: Array<[string, string]>) =>
    options.map(([label, explanation]) => ({
      value: label,
      label,
      explanation,
    }));

  const milestoneOptions = [
    ["Scrutiny", "Shows the selected files' Scrutiny status or completion history."],
    ["High Value", "Shows files identified under the High Value workflow step."],
    ["Pre-TCEC", "Shows the Pre-TCEC step/status for selected files."],
    ["AD", "Shows the AD step/status for selected files."],
    ["R&QA", "Shows the R&QA step/status for selected files."],
    ["Controlling", "Shows the Controlling step/status for selected files."],
    ["IFA", "Shows the IFA step/status for selected files."],
    ["CFA", "Shows the CFA step/status for selected files."],
    ["Bidding", "Shows the Bidding step/status for selected files or orders."],
    ["Post-TCEC", "Shows the Post-TCEC step/status for selected files or orders."],
    ["CNC", "Shows the CNC step/status for selected files."],
    ["Financial Sanction", "Shows the Financial Sanction step/status for selected files or expected S.O.s."],
    ["Supply Order", "Shows S.O. records belonging to the selected files."],
    ["Delivery", "Shows delivery status for selected S.O.s or stages."],
    ["Bill preparation", "Shows bill-preparation status for selected payment cases."],
    ["Payment", "Shows payment status/history for selected files or payment cases."],
  ] as Array<[string, string]>;

  const optionsBySection: Record<string, FilterGuideOption[]> = {
    status1: make([
      ["Total Files", "Counts files in the selected workflow scope; it is not an event count."],
      ...milestoneOptions.slice(0, 8),
      ["Supply Order", "Shows files/orders at or beyond S.O. placement under Status-1 counting rules."],
      ["Payment", "Shows payment-related counts for the selected files; historical dates may be earlier."],
      ["Delivery", "Shows delivery-related counts for the selected files/orders."],
      ["Files Closed", "Shows closure status/date for files within the selected scope."],
    ]),
    liveStatus: make([
      ...milestoneOptions.slice(0, 14),
      ["Advance Payment", "Shows pending or current advance-payment cases tied to selected S.O.s."],
      ["PSB / PWB", "Shows pending security/bill milestones for selected S.O.s."],
      ["IR Preparation / Receipt", "Shows inspection-record steps for selected deliveries."],
      ["Bill sent for payment", "Shows payment cases whose bill has been sent, based on current recorded status."],
    ]),
    status3: make(milestoneOptions),
    status4: make(milestoneOptions.slice(0, 12)),
    snapshot: make([
      ["File Type distribution", "Groups selected files by their file type."],
      ["Firm Type distribution", "Groups firm/order records in selected files by firm type; it is not automatically restricted to S.O.s placed in the Global FY."],
      ["Division distribution", "Groups selected files by division."],
      ["Bidding Type", "Groups selected files by recorded bidding type."],
      ["GeM Bidding Mode", "Groups selected files by recorded GeM bidding mode."],
      ["File value distribution", "Groups selected files using their recorded file-value bands."],
    ]),
    analytics: make([
      ["Division Ranking by Files and S.O.", "Ranks divisions by unique files or dated S.O. records in the selected file scope."],
      ["Division ranking by value", "Compares current Intended, Booked, Committed, and related values from selected files."],
      ["Division ranking by total value", "Compares total value measures for the selected files."],
      ["Division turnaround ranking", "Uses Demand Received to first S.O. dates for selected files."],
      ["Firms ranking by S.O. value", "Ranks firms by S.O. values recorded in selected files; S.O. dates need not be in the Global FY."],
      ["Firm Analysis", "Counts firm roles (BQ, invited, participated, got order) from selected-file records."],
      ["Indentor–Firm", "Shows S.O. relationships between indentors and firms in selected files."],
      ["Top Indentors by Files and S.O.", "Ranks indentors by unique files or dated S.O. records in the selected file scope."],
      ["Indentors ranking by value", "Ranks indentors by values from selected files."],
      ["Bidding mode", "Compares files by recorded bidding mode."],
      ["File value thresholds", "Counts selected files within value thresholds."],
      ["Payment pending by division", "Shows currently pending payment amounts/cases in the selected file scope."],
      ["Pre-Bid Meetings", "Groups meeting records by their meeting dates when an Activity FY is applied."],
      ["TCEC summary", "Groups TCEC records by their recorded event dates when an Activity FY is applied."],
      ["CNC summary", "Groups CNC records by their recorded event dates when an Activity FY is applied."],
      ["Suspected anomaly", "Shows current anomaly matches in the selected file scope; not an event-year count."],
      ["Delay status", "Shows current delay conditions in selected files; it is not necessarily a count of delays starting in the Global FY."],
      ["Milestone clearing analysis", "Compares milestone clearing times for selected files. Open the chart info for stage-specific start and end dates, including the TCEC and Non-TCEC rules."],
    ]),
    fySnapshot: make([
      ["Allocated", "Shows the budget currently recorded for the selected FY and division."],
      ["Intended", "Shows current file estimates for files initiated in the selected FY."],
      ["Booked", "Shows booked values for the selected FY file group, using the page's booked-stage rules."],
      ["Committed", "Shows current S.O. values for the selected FY file group, using the page's commitment rules."],
      ["Paid Till Date", "Shows payment entries dated through the displayed as-of date for the selected FY file group."],
      ["Year-end unpaid liability", "Shows unpaid liability at the selected FY-end cutoff for that FY's file group."],
      ["Capital and Revenue comparison", "Compares the selected financial measures split into Capital and Revenue."],
    ]),
    fyActivity: make([
      ["Intended", "Uses current file estimates for the selected file scope; it is not itself a dated activity."],
      ["Booked", "Uses booked-stage values for selected files; the stage date/scope follows the measure rules."],
      ["Committed", "Uses S.O. values in selected files; the selected Global FY does not automatically limit S.O. dates."],
      ["Payment in selected FY", "Selects payment entries by payment date in the Global FY."],
      ["Balance Carry Forward from previous FYs", "Shows unpaid amounts linked to S.O.s placed before the selected FY."],
      ["Cleared Carry Forward in selected FY", "Shows payments made in the selected FY for S.O.s placed in any earlier FY. These do not have to have been unpaid at the previous FY-end."],
      ["Balance Carry Forward of selected FY", "Shows payments for S.O.s placed in the selected FY that remain unpaid at the applicable cutoff."],
      ["S.O. placed", "Counts S.O.s by their placement date in the selected activity FY."],
      ["Live S.O.", "Counts non-cancelled, non-shortclosed S.O.s whose parent file has no recorded closure."],
      ["Files closed", "Counts files by their recorded closure date in the selected activity FY."],
      ["Payments in selected FY", "Groups payments made in the selected FY by the related S.O.'s FY. Entries without a usable S.O. date are listed as unavailable."],
      ["Firm Type distribution", "S.O. values are grouped by the S.O. firm's type. Payment amounts are grouped by the related S.O. firm's type."],
    ]),
    reports: make([
      ["Pre-Bid Meetings", "Uses meeting-date activity when the report is date-based."],
      ["TCEC summary", "Uses TCEC event dates when the report is date-based."],
      ["CNC summary", "Uses CNC event dates when the report is date-based."],
      ["Payment reports", "Uses the payment or bill date specified by the selected report."],
      ["Month-wise Supply Orders", "Groups S.O.s by S.O. placement date."],
      ["Cash Out Go", "Follows its Plan FY and Division; it is a plan and payment view, not a general file-initiation view."],
      ["Pre-S.O. expected cash outgo", "Uses its fixed active-file planning scope; the Global Filter does not control this report."],
    ]),
    search: make([
      ["Payment Date", "Finds matching payment entries by payment date, across payment types supported by Search."],
      ["S.O. Date", "Finds files/S.O.s matching the selected S.O. date criteria."],
      ["File Initiation Date", "Filters by when the file was initiated, not when a payment or S.O. occurred."],
      ["File Type", "Narrows results by selected file categories."],
      ["Division", "Narrows results by division."],
    ]),
    quickEntry: make([
      ["File code lookup", "Opens the file matching the entered file code."],
      ["Barcode lookup", "Looks up a file using its barcode."],
      ["Status entry", "Opens the selected file for direct status entry."],
    ]),
  };

  return optionsBySection[sectionKey] ?? [];
}

function getFilterGuideCombinations(
  currentFinancialYear: string,
  sectionKey: string,
): FilterGuideCombination[] {
  const currentFy = displayFinancialYearLabel(currentFinancialYear);
  const currentStart = readFinancialYearStart(currentFinancialYear);
  const previousFy = currentStart !== undefined
    ? `${currentStart - 1}-${String(currentStart % 100).padStart(2, "0")}`
    : "previous FY";

  if (sectionKey === "fySnapshot") {
    return [{
      globalFilter: "Selected specific FY",
      subfilter: "Locked to the same FY",
      files: "Files initiated in the selected FY.",
      example: `Global Filter ${currentFy} + Subfilter ${currentFy} shows files initiated in ${currentFy}; choosing an older FY changes both together.`,
    }];
  }
  if (sectionKey === "search") {
    return [
      {
        globalFilter: currentFy,
        subfilter: "Not available",
        files: `Files in the ${currentFy} Global Filter scope, further narrowed by Search criteria.`,
        example: `A file initiated in ${previousFy} may match when its payment date is in ${currentFy}.`,
      },
      {
        globalFilter: "Active + current FY closed",
        subfilter: "Not available",
        files: `Files active today plus files closed during ${currentFy}; Search criteria further narrow the results.`,
        example: "Use a payment-date criterion to find payments in a date range; the Global Filter does not set that payment date range.",
      },
      {
        globalFilter: "All active files",
        subfilter: "Not available",
        files: "Currently active files, subject to the Search criteria.",
        example: "A closed file is excluded even if it has a payment in the chosen date range.",
      },
      {
        globalFilter: "All files",
        subfilter: "Not available",
        files: "All accessible files, subject to the Search criteria.",
        example: "A payment-date search can find matching payments on files initiated in any FY.",
      },
    ];
  }
  if (sectionKey === "quickEntry") {
    return [{
      globalFilter: "Not applied",
      subfilter: "Not available",
      files: "Quick Entry looks up the specific file or code entered; filter combinations do not change its scope.",
      example: "Entering a file code opens that file regardless of its initiation FY, status, or activity dates.",
    }];
  }
  return [
    {
      globalFilter: currentFy,
      subfilter: "All file years",
      files: `Files connected with ${currentFy}, across initiation years. This includes files started in ${currentFy} and qualifying older files.`,
      example: `A ${previousFy}-initiated file can remain in scope. Its event contributes only when the section's own measure uses a matching event date.`,
    },
    {
      globalFilter: currentFy,
      subfilter: currentFy,
      files: `Only files initiated in ${currentFy} that also meet the ${currentFy} Global Filter rules.`,
      example: `A payment in ${currentFy} for a file initiated in ${currentFy} may be included if this section counts that payment; the pair itself does not make every value a payment-in-year measure.`,
    },
    {
      globalFilter: currentFy,
      subfilter: previousFy,
      files: `Only ${previousFy}-initiated files that also meet the ${currentFy} Global Filter rules.`,
      example: `This asks what the selected section shows for qualifying ${previousFy} files in the ${currentFy} file scope; it does not mean the activity happened in ${previousFy}.`,
    },
    {
      globalFilter: currentFy,
      subfilter: `Later than ${currentFy}`,
      files: `Normally no files: a later initiation year does not belong to the ${currentFy} Global Filter scope.`,
      example: `If this combination shows any rows, check the file's recorded active-year history and the section's own inclusion rules.`,
    },
    {
      globalFilter: "Active + current FY closed",
      subfilter: "All file years",
      files: `Files active today plus files closed during ${currentFy}, across initiation years.`,
      example: `An older file active today is included even without an event dated in ${currentFy}; files closed before ${currentFy} are excluded.`,
    },
    {
      globalFilter: "Active + current FY closed",
      subfilter: previousFy,
      files: `The operational set above, limited to files initiated in ${previousFy}.`,
      example: `Shows only the selected section's results for ${previousFy}-initiated files that are active today or were closed in ${currentFy}.`,
    },
    {
      globalFilter: "Active + current FY closed",
      subfilter: currentFy,
      files: `The operational set above, limited to files initiated in ${currentFy}.`,
      example: `Older active files and older files closed in ${currentFy} are removed by the ${currentFy} initiation-year subfilter.`,
    },
    {
      globalFilter: "All active files",
      subfilter: "All file years",
      files: "Files active now across all initiation years; closed and cancelled files are excluded by this Global Filter rule.",
      example: "This is a current active-file scope, not a list of every file that had activity during the FY.",
    },
    {
      globalFilter: "All active files",
      subfilter: "Any specific FY",
      files: "Currently active files initiated in the selected FY.",
      example: `For example, choose ${currentFy} or ${previousFy} to see only currently active files started in that FY.`,
    },
    {
      globalFilter: "All files",
      subfilter: "All file years",
      files: "All accessible files across all initiation years and closure states; individual measures may still apply their own exclusions.",
      example: "Use for a broad database view. A selected Global FY is not implied, and event-based measures may have their own date scope.",
    },
    {
      globalFilter: "All files",
      subfilter: "Any specific FY",
      files: "All accessible files initiated in the selected FY, regardless of closure status.",
      example: `For example, choose ${currentFy} or ${previousFy} to see all accessible files started in that FY; events are not date-limited by this choice.`,
    },
  ];
}

function SectionFilterGuideDialog({
  open,
  onOpenChange,
  currentTitle,
  currentDescription,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  currentDescription: string;
  sections: FilterGuideSection[];
}) {
  const guideBullets = (text: string) =>
    text
      .replaceAll("S.O.", "S§O§")
      .replaceAll("D.P.", "D§P§")
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map((line) => line.replaceAll("S§O§", "S.O.").replaceAll("D§P§", "D.P.").trim())
      .filter(Boolean);

  const exportPdf = () => {
    const tables: ExportTable[] = [
      {
        title: "How the filters work",
        headers: ["Filter", "Meaning"],
        rows: [
          ["Global Filter", guideBullets(currentDescription).map((line) => `- ${line}`).join("\n")],
          ["Subfilter", "Narrows eligible files by File Initiation Year. It does not set the year of an event."],
          ["Activity Year", "The FY containing a dated event, but only for measures that use that event date. Other measures may show current status or recorded history."],
        ],
        columnWidths: [140, 440],
      },
      {
        title: "Section meanings",
        headers: ["Section", "Files and records included", "What the FY means"],
        rows: sections.map((section) => [
          section.label,
          guideBullets(section.fileScope).map((line) => `- ${line}`).join("\n"),
          guideBullets(section.activityYear).map((line) => `- ${line}`).join("\n"),
        ]),
        columnWidths: [105, 245, 245],
      },
    ];
    void downloadBackendExport({
      format: "pdf",
      title: "Filter Guide",
      subtitle: `Current Global Filter: ${currentTitle}`,
      description: currentDescription,
      fileName: "filter-guide.pdf",
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
                Global Filter and Subfilter select files. Each section may count dates and records differently.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
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
            <div className="text-xs font-semibold uppercase text-muted-foreground">Current Global Filter</div>
            <div className="mt-1 text-sm font-semibold">{currentTitle}</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              {guideBullets(currentDescription).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>

          <div className="mb-4 border-l-4 border-primary px-4 py-2">
            <h3 className="text-sm font-bold">Scope of Global Filters</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              <li><strong>Active + current FY closed:</strong> Files active now, plus files closed during the current FY. Cancelled files are excluded.</li>
              <li><strong>All active files:</strong> Files active now, across all initiation years. Closed and cancelled files are excluded.</li>
              <li><strong>All files:</strong> All accessible files, across all initiation years, including closed and cancelled files.</li>
              <li><strong>Specific FY:</strong> Files initiated in that FY, plus older files that were active when the FY began.</li>
              <li>Those older files remain included if they closed later.</li>
              <li>Files initiated after the selected FY are not included.</li>
              <li>The Subfilter narrows the selected files by <strong>File Initiation Year</strong>.</li>
              <li>The Global FY does not automatically limit every measure to events dated in that FY.</li>
              <li>An event-date limit applies only when that measure uses the event date.</li>
            </ul>
          </div>

          <section className="mt-5">
            <h3 className="mb-2 text-sm font-bold">How each section uses the selected files</h3>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="w-[18%] border-b border-border px-3 py-2 text-left font-semibold">Section</th>
                    <th className="w-[41%] border-b border-border px-3 py-2 text-left font-semibold">Files and records included</th>
                    <th className="w-[41%] border-b border-border px-3 py-2 text-left font-semibold">What the FY means</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section) => (
                    <tr key={section.key} className="border-t border-border align-top">
                      <th className="px-3 py-2 text-left font-semibold">{section.label}</th>
                      <td className="px-3 py-2 text-muted-foreground">
                        <ul className="list-disc space-y-1 pl-4">
                          {guideBullets(section.fileScope).map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <ul className="list-disc space-y-1 pl-4">
                          {guideBullets(section.activityYear).map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getSectionFilterGuide(currentFinancialYear: string): FilterGuideSection[] {
  const currentFy = displayFinancialYearLabel(currentFinancialYear);
  const currentStart = readFinancialYearStart(currentFinancialYear);
  const previousFy = currentStart !== undefined
    ? `${currentStart - 1}-${String(currentStart % 100).padStart(2, "0")}`
    : "previous FY";
  const selectedFy = `Current FY ${currentFy}`;
  const activeWithCurrentClosed = "Active + current FY closed";
  const allYears = "All file years";

  return [
    {
      key: "status1", label: "Status-1", globalFilter: activeWithCurrentClosed, subfilter: allYears,
      fileScope: "Files active now, plus files closed during the current FY, from any initiation year. Cancelled files are excluded from most workflow counts; cancellation-history counts have their own rules.",
      activityYear: "This is not a count of events in one FY. Pending, due, and overdue counts show the current work position; completed counts can include work completed in earlier years.",
      examples: [
        `A file initiated in ${previousFy} that is still active today is included even if it had no event dated in ${currentFy}.`,
        `A file closed during ${currentFy} is included; one closed before ${currentFy} is outside this recommended file scope.`,
        `A file with Scrutiny completed in ${previousFy} can still count as Scrutiny completed now if that file is in scope.`,
      ],
    },
    {
      key: "status2", label: "Status-2", globalFilter: activeWithCurrentClosed, subfilter: allYears,
      fileScope: "Files active now, plus files closed during the current FY, from any initiation year. Cancelled files are excluded from pending work.",
      activityYear: "Shows where S.O. and delivery work is waiting now, not when it started. One file can contribute several pending cases.",
      examples: [
        `An S.O. from ${previousFy} still waiting for a current step can appear in the ${currentFy} view.`,
        "A file with multiple pending S.O./delivery cases may contribute more than once to a case count.",
        "Changing the Subfilter to 2025-26 would restrict files to that initiation year; it would not mean activity happened in 2025-26.",
      ],
    },
    {
      key: "status3", label: "Status-3", globalFilter: activeWithCurrentClosed, subfilter: allYears,
      fileScope: "Files active now, plus files closed during the current FY, from any initiation year. It uses the same measures as Status-1, in tables.",
      activityYear: "Shows the current workflow position and recorded completion history; a completed step may have happened in an earlier FY.",
      examples: [
        `A payment or milestone completed in ${previousFy} can remain in the completed/history count in ${currentFy}.`,
        "Use this to read Status-1 counters in tabular form, not as a count of events that occurred this FY.",
      ],
    },
    {
      key: "status4", label: "Status-4", globalFilter: activeWithCurrentClosed, subfilter: allYears,
      fileScope: "Files active now, plus files closed during the current FY, from any initiation year.",
      activityYear: "Compares current milestone counts and recorded history. Selecting an FY does not make every milestone date fall in that FY.",
      examples: [
        `A file initiated in ${previousFy} may appear at its current pre-S.O. stage in ${currentFy}.`,
        "A milestone completed earlier can remain part of the file's workflow history.",
      ],
    },
    {
      key: "snapshot", label: "Snapshot", globalFilter: currentFy, subfilter: currentFy,
      fileScope: "Files selected by Global Filter and narrowed by File Initiation Year, initiation-date range, Division, and File Type.",
      activityYear: "Most Snapshot measures describe the selected files. Some, such as firm distribution, use related S.O. records; check that measure's tooltip for its date rule.",
      examples: [
        `With Global Filter = ${currentFy} and Subfilter = ${currentFy}, Snapshot focuses on files initiated in ${currentFy}.`,
        `The selected FY limits which files are included; S.O. and payment records shown for those files may have their own date basis.`,
        "Use each Snapshot measure's basis to tell whether it represents a year-end position, dated activity, or current records.",
      ],
    },
    {
      key: "analytics", label: "Analytics", globalFilter: "Most panels: Current FY. Firm Analysis, Firms ranking by S.O. value, and Indentor–Firm: All files.",
      subfilter: "Most panels: File & Ranking Analysis uses Current FY; Activity & Monitoring Analysis uses All file years. Firm Analysis, Firms ranking by S.O. value, and Indentor–Firm use All files + All file years.",
      fileScope: "The selected Analytics panel uses files allowed by Global Filter, File Initiation Year, date range, Division, and File Type. Its tooltip gives any additional record rules.",
      activityYear: "Some panels count events dated in a year; others show current status or file history. Global Filter does not automatically date-limit every measure.",
      examples: [
        `Pre-Bid, TCEC, and CNC schedules group records by their event dates; a file started in ${previousFy} can contribute an event dated in ${currentFy} when All file years is selected.`,
        "Payment pending, Delay status, and Suspected anomaly describe current/recorded conditions, not necessarily events that occurred in the Global FY.",
        `Firms ranking by S.O. value, Firm Analysis, and Indentor–Firm use S.O./firm history in the selected files; an S.O. dated ${previousFy} may contribute.`,
        `For File & Ranking Analysis, the recommended Subfilter ${currentFy} selects files initiated in ${currentFy}; it does not by itself limit each measure's source records to events dated in ${currentFy}.`,
      ],
    },
    {
      key: "fySnapshot", label: "FY Snapshot", globalFilter: "Select the FY to review", subfilter: "Locked to the same FY",
      fileScope: "Files initiated in the selected FY, narrowed by the initiation-date range and other file filters. Some measures also follow the Global Filter's file scope; others do not.",
      activityYear: "Each measure has its own date rule. Some use a cutoff date, some use payment or S.O. dates, and some show current recorded values.",
      examples: [
        `Global Filter ${currentFy} + Subfilter ${currentFy} selects files initiated in ${currentFy}.`,
        `A payment made in ${currentFy} for a file initiated in ${previousFy} is not part of the ${currentFy}-initiated file group.`,
        "Use the basis/helper on each box to distinguish year-end position from later payment or current figures.",
      ],
    },
    {
      key: "fyActivity", label: "FY Activity", globalFilter: "Select the activity FY", subfilter: allYears,
      fileScope: "Global Filter selects the files; File Initiation Year can narrow them to one start year. The subfilter does not change the activity period.",
      activityYear: "Payment counts use payment dates, and S.O. counts use placement dates. Carry-forward panels also show the related S.O. FY, which can differ from the payment FY.",
      examples: [
        `An S.O. placed in ${currentFy} for a file initiated in ${previousFy} belongs to ${currentFy} activity with Subfilter All file years.`,
        `A ${previousFy} liability paid in ${currentFy} is a ${currentFy} payment that clears a ${previousFy} liability.`,
        `Global Filter ${currentFy} + Subfilter ${previousFy} keeps the activity period in ${currentFy} but limits files to those initiated in ${previousFy}.`,
      ],
    },
    {
      key: "reports", label: "Reports", globalFilter: selectedFy, subfilter: allYears,
      fileScope: "Each report has its own file scope. Some follow the page filters; others use a fixed or report-specific scope shown in that report's helper.",
      activityYear: "Date-based reports use the FY of the event they measure. Planning and current-status reports may use a different date rule; check the report's helper.",
      examples: [
        `A file initiated in ${previousFy} with a Pre-Bid or S.O. event dated in ${currentFy} can appear in the ${currentFy} event-date report.`,
        "Cash Out Go follows its Plan FY and selected month, not necessarily the file initiation year.",
        "Pre-S.O. expected cash outgo uses its fixed active-file scope; the Global Filter does not control it.",
      ],
    },
    {
      key: "search", label: "Search Files", globalFilter: "User's selection (recommended: Active + current FY closed)", subfilter: "Not available on this page",
      fileScope: "Global Filter and Search criteria select matching files. Division, File Type, and date filters narrow the results further.",
      activityYear: "A date filter searches the selected date, such as Payment Date. Without one, Global Filter selects files; it does not set a payment date range.",
      examples: [
        "Filtering Payment Date to a range finds matching recorded payment entries/files; it does not mean the files were initiated in that range.",
        `A file initiated in ${previousFy} can match a payment-date search in ${currentFy}.`,
      ],
    },
    {
      key: "quickEntry", label: "Quick Entry", globalFilter: "Not applied", subfilter: "Not available",
      fileScope: "Quick Entry opens the file or record identified by the code entered. Global Filter does not restrict it.",
      activityYear: "Quick Entry does not filter by Activity Year.",
      examples: ["Entering a file code opens that file regardless of its initiation year or activity dates."],
    },
  ];
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
            "Files started in that FY appear, along with active files carried forward from earlier years. Cancelled files may also appear.",
            `For ${displayFinancialYearLabel(currentFinancialYear)}: files started in that FY, plus active files carried forward from earlier years. Files closed during that FY are included too. Active + current FY closed excludes cancelled/all-S.O.-cancelled files.`,
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
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
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
              A specific FY includes files started in that year and active files carried forward
              from earlier years. Active + current FY closed shows today's active files plus files
              closed this FY; it excludes cancelled demands and files with only cancelled S.O.s.
            </p>
	            <div className="mt-3">
	              <HelperContent
	                lines={[
	                  "Example table: Global Filter / subfilter | Example file | Result",
	                  `Example row: Global ${displayFinancialYearLabel(currentFinancialYear)} | File started in ${displayFinancialYearLabel(currentFinancialYear)} or was active on 1 Apr ${displayFinancialYearLabel(currentFinancialYear)}; it may close during that FY | Included if it meets the selected FY rules; event-date reports still apply their own event dates.`,
	                  `Example row: Global ${previousFyLabel} | File started in ${previousFyLabel} or was active on 1 Apr ${previousFyLabel}; it closes during ${previousFyLabel} | Included for that FY; files closed before ${previousFyLabel} are excluded.`,
	                  `Example row: Global ${displayFinancialYearLabel(currentFinancialYear)}; initiation subfilter ${previousFyLabel} | File was received in ${previousFyLabel} and qualifies under the Global FY | Included only if it meets the Global FY scope and the initiation-year subfilter.`,
	                  "Example row: Global Active + current FY closed; all initiation years | Older file is active today but has no event dated in the selected FY | Included in file scope; an event-date measure may still have no event to count.",
	                ]}
	              />
	            </div>
          </div>
          <div className="mb-4 rounded-md border border-amber-600/40 bg-amber-500/10 px-4 py-3">
            <div className="text-sm font-bold text-foreground">
              Important: Specific FY is not a full activity-year file list
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              A file from an earlier FY is included when it is carried forward as active into the
              selected FY. Files closed during that FY remain included. Other files may be absent
              even if they had
              no recorded activity date. To see today&apos;s active files even when no activity is
              dated in the current FY, choose <strong>Active + current FY closed</strong>. That
              includes today&apos;s active files and files closed during the current FY.
            </p>
          </div>
          <div className="mb-4 rounded-md border border-primary/25 bg-primary/5 px-4 py-3">
            <div className="text-sm font-bold text-foreground">
              File scope and activity period are different
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Global Filter and File Initiation Year select which files are eligible. They do not,
              by themselves, limit every S.O. or payment to the Global Filter FY; each page,
              measure, or report applies its own date rule.
            </p>
	            <div className="mt-2">
	              <HelperContent
	                lines={[
	                  "Example table: Measure | Selected file scope | Event-date treatment",
	                  "Example row: Snapshot Firm Type distribution | Active + current FY closed; all file years | Firm types from S.O.s in any FY can be considered; the Global FY selects files, not S.O. placement dates.",
	                  "Example row: Report explicitly based on an event date | Same file scope; event occurred outside selected FY | The file may be in scope, but the event is excluded from that FY's event total.",
	                ]}
	              />
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
          `Files started in that FY, plus active files carried forward from earlier years. Files closed during that FY are also included.`,
        examples: [
          `File started in ${currentFyLabel}: included.`,
          `Older file carried forward as active, then closed later: included in ${currentFyLabel}.`,
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
      {
        filter: "File scope vs activity period",
        useWhen: "Check whether a result is file-based or limited by an event date.",
        shows:
          "Global Filter and File Initiation Year select eligible files; the option's own rules determine which dated activities within those files are counted.",
        examples: [
          `Global Filter Active + current FY closed + Subfilter All file years selects today's active files plus files closed in ${currentFyLabel}, across initiation years.`,
          "Snapshot Firm Type distribution counts matching S.O. firm types found anywhere in those files, including S.O.s placed in previous FYs.",
          `An event-date report for ${currentFyLabel} counts only events whose dates fall in ${currentFyLabel}, even when the related file started earlier.`,
          "Use the page or measure helper text to confirm its date and record rules; the filter combination alone does not define them.",
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
          "Firm Type distribution reflects S.O. firm types recorded in the selected files; it is not limited to S.O.s placed in the selected FY.",
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
  analyticsPanel: string | undefined,
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
      fileYear: "",
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
        activityYear: usesAllFilesAnalyticsScope(analyticsPanel) ? "All files" : currentFyLabel,
        fileYear: getRecommendedAnalyticsSubfilter(analyticsPanel),
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
        activityYear: currentFyLabel,
        fileYear: currentFyLabel,
      };
    }
    if (dashboardTab === "snapshot") {
      return {
        activityYear: currentFyLabel,
        fileYear: currentFyLabel,
      };
    }
    if (dashboardTab === "fyActivity") {
      return {
        activityYear: currentFyLabel,
        fileYear: "All file years",
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

function getSelectedFileYearLabel(
  pathname: string,
  dashboardTab: string | undefined,
  userId: string | undefined,
  selectedGlobalYear: string,
  recommendedFileYear: string,
) {
  if (pathname === "/search" || pathname === "/quick-entry" || pathname === "/add") {
    return "Not used on this page";
  }
  if (pathname === "/dashboard" && dashboardTab === "finance1") {
    return displayFinancialYearLabel(selectedGlobalYear);
  }
  let selectedFileYear: string | undefined;
  if (typeof window !== "undefined") {
    try {
      const suffix = pathname === "/dashboard" && dashboardTab === "fyActivity" ? ":fy-activity" : "";
      const saved = JSON.parse(
        window.sessionStorage.getItem(
          `recordkeeper:file-year-filter:${userId ?? "anonymous"}${suffix}`,
        ) ?? "null",
      );
      if (typeof saved?.year === "string") selectedFileYear = saved.year;
    } catch {
      // Fall back to the page's recommended Subfilter for this preview.
    }
  }
  selectedFileYear ??= recommendedFileYear === "No change" ? undefined : recommendedFileYear;
  if (!selectedFileYear) return "Not available on this page";
  if (selectedFileYear === "all") {
    return selectedGlobalYear === ALL_FILES_YEAR ? "Entire database" : "All file years";
  }
  return displayFinancialYearLabel(selectedFileYear);
}

function getSelectedFileYearValue(
  pathname: string,
  dashboardTab: string | undefined,
  userId: string | undefined,
  selectedGlobalYear: string,
  recommendedFileYear: string,
) {
  if (pathname === "/dashboard" && (dashboardTab === "finance1" || dashboardTab === "snapshot")) {
    return selectedGlobalYear;
  }
  if (pathname === "/search" || pathname === "/quick-entry" || pathname === "/add") {
    return "all";
  }
  let selectedFileYear: string | undefined;
  if (typeof window !== "undefined") {
    try {
      const suffix = pathname === "/dashboard" && dashboardTab === "fyActivity" ? ":fy-activity" : "";
      const saved = JSON.parse(
        window.sessionStorage.getItem(
          `recordkeeper:file-year-filter:${userId ?? "anonymous"}${suffix}`,
        ) ?? "null",
      );
      if (typeof saved?.year === "string") selectedFileYear = saved.year;
    } catch {
      // Fall back to the page's recommended Subfilter.
    }
  }
  if (selectedFileYear === "all" || selectedFileYear === "__all__") return "all";
  return selectedFileYear
    ? normalizeFinancialYearLabel(selectedFileYear) || selectedFileYear
    : recommendedFileYear === "All file years" || recommendedFileYear === "Entire database"
      ? "all"
      : normalizeFinancialYearLabel(recommendedFileYear) || "all";
}

function getGlobalFilterDisplayLabel(value: string) {
  if (value === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR) return "Active + current FY closed";
  if (value === ALL_ACTIVE_FILES_YEAR) return "All active files";
  if (value === ALL_FILES_YEAR) return "All files";
  return displayFinancialYearLabel(value);
}

function getRecommendedGlobalFilterValue(
  pathname: string,
  dashboardTab: string | undefined,
  analyticsPanel: string | undefined,
  reportMode: string | undefined,
  currentFinancialYear: string,
  currentSelectedYear: string,
) {
  if (pathname === "/search") return ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
  if (pathname === "/reports") {
    return reportMode === "preSoExpectedCashOutgo" ? ALL_ACTIVE_FILES_YEAR : currentFinancialYear;
  }
  if (pathname === "/dashboard") {
    if (dashboardTab === "analytics" && usesAllFilesAnalyticsScope(analyticsPanel)) {
      return ALL_FILES_YEAR;
    }
    if (dashboardTab === "snapshot" || dashboardTab === "finance1" || dashboardTab === "finance" || dashboardTab === "fyActivity" || dashboardTab === "analytics") {
      return currentFinancialYear;
    }
    return ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
  }
  return currentSelectedYear || ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function isGlobalFilterNonSuggested(
  pathname: string,
  dashboardTab: string | undefined,
  analyticsPanel: string | undefined,
  reportMode: string | undefined,
  selectedYear: string | undefined,
  currentFinancialYear: string,
) {
  if (pathname === "/search") return selectedYear !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
  if (pathname === "/reports") {
    if (reportMode === "preSoExpectedCashOutgo") return selectedYear !== ALL_ACTIVE_FILES_YEAR;
    return selectedYear !== currentFinancialYear;
  }
  if (pathname !== "/dashboard") return false;
  if (dashboardTab === "finance1" || dashboardTab === "fyActivity") {
    return selectedYear !== currentFinancialYear;
  }
  if (dashboardTab === "snapshot") return selectedYear !== currentFinancialYear;
  if (dashboardTab === "analytics" && usesAllFilesAnalyticsScope(analyticsPanel)) {
    return selectedYear !== ALL_FILES_YEAR;
  }
  if (dashboardTab === "finance" || dashboardTab === "analytics") {
    return selectedYear !== currentFinancialYear;
  }
  return selectedYear !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR;
}

function isSubfilterNonSuggested(
  pathname: string,
  dashboardTab: string | undefined,
  analyticsPanel: string | undefined,
  reportMode: string | undefined,
  currentFinancialYear: string,
  selectedGlobalYear: string,
  userId: string | undefined,
) {
  if (pathname === "/search" || pathname === "/quick-entry" || pathname === "/add") {
    return false;
  }
  if (pathname === "/reports" && reportMode === "preSoExpectedCashOutgo") return false;
  if (pathname !== "/dashboard" && pathname !== "/reports") return false;

  const key = `recordkeeper:file-year-filter:${userId ?? "anonymous"}${
    pathname === "/dashboard" && dashboardTab === "fyActivity" ? ":fy-activity" : ""
  }`;
  let selectedFileYear =
    pathname === "/dashboard" && dashboardTab === "finance1"
      ? selectedGlobalYear
      : pathname === "/dashboard" && dashboardTab === "fyActivity"
        ? "all"
        : currentFinancialYear;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (typeof saved?.year === "string") selectedFileYear = saved.year;
  } catch {
    // Treat an unavailable saved subfilter as its page default.
  }
  if (pathname === "/dashboard" && dashboardTab === "finance1") {
    selectedFileYear = selectedGlobalYear;
  }

  const recommendedFileYear = dashboardTab === "snapshot" || dashboardTab === "finance1"
    ? normalizeFinancialYearLabel(currentFinancialYear) || currentFinancialYear
    : dashboardTab === "analytics"
      ? getRecommendedAnalyticsSubfilter(analyticsPanel) === "All file years"
        ? "all"
        : normalizeFinancialYearLabel(currentFinancialYear) || currentFinancialYear
      : "all";
  const normalizedSelectedFileYear = normalizeFinancialYearLabel(selectedFileYear);
  return normalizedSelectedFileYear !== normalizeFinancialYearLabel(recommendedFileYear);
}

function getRecommendedAnalyticsSubfilter(analyticsPanel: string | undefined) {
  const allFileYearsPanels = new Set([
    "paymentPending",
    "delayStatus",
    "suspectedAnomaly",
    "preBidMeetings",
    "tcecStatus",
    "cncSummary",
    "topFirms",
    "firmAnalysis",
    "firmPerformance",
    "indentorFirmLinkage",
    "demandProcessingAnalysis",
  ]);
  return allFileYearsPanels.has(analyticsPanel ?? "") ? "All file years" : "Current FY";
}

function usesAllFilesAnalyticsScope(analyticsPanel: string | undefined) {
  return new Set([
    "topFirms",
    "firmAnalysis",
    "indentorFirmLinkage",
    "firmPerformance",
  ]).has(analyticsPanel ?? "");
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
	          : `Shows files started in FY ${selectedFyLabel}, plus active files carried forward from earlier years. Files closed during that FY are also included.`;

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
