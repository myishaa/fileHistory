import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  FilePlus2,
  CircleHelp,
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
  displayFinancialYearLabel,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";

const nav = [
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/quick-entry", label: "Quick Entry", icon: ScanLine },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: CircleHelp },
] as const;

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const settings = useSettings();
  const messages = useMessages();
  const fileProcessingNotifications = useFileProcessingNotifications();
  const activeUser = useActiveUser();
  const [anomalyWarningCount, setAnomalyWarningCount] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const isDark = settings.theme === "dark";
  const canManageAdminSettings = activeUser?.role === "admin";
  const canUpdateAppearance = Boolean(activeUser);
  const canSelectYear = Boolean(activeUser);
  const canViewUserSettings = Boolean(activeUser);
  const globalFilterHelp = getGlobalFilterHelp(settings.selectedYear, settings.financialYear);
  const canAddFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const canUseQuickEntry = canAddFiles || activeUser?.role === "universal_viewer";
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
  const yearOptions = Array.from(
    new Set(
      [
        settings.financialYear,
        settings.selectedYear,
        ...settings.financialYears,
      ]
        .map((year) => normalizeFinancialYearLabel(year))
        .filter(
          (year): year is string =>
            Boolean(year) &&
            year !== ALL_ACTIVE_FILES_YEAR &&
            year !== ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR,
        ),
    ),
  ).sort((a, b) => b.localeCompare(a));

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
              {bellCount ? (
                <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                  {bellCount}
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
                  {!bellCount ? (
                    <div className="rounded-md px-2 py-2 text-sm text-muted-foreground">
                      No active warnings.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
              <CalendarDays className="size-4 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground">Year</span>
              <select
                value={settings.selectedYear}
                onChange={(event) => store.updateSettings({ selectedYear: event.target.value })}
                disabled={!canSelectYear}
                className="h-6 min-w-20 bg-transparent text-sm font-semibold text-foreground outline-none"
              >
                <option value={ALL_ACTIVE_FILES_YEAR}>All active files</option>
                <option value={ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR}>
                  Active + current FY closed
                </option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {displayFinancialYearLabel(year)}
                  </option>
                ))}
              </select>
            </label>
            <div className="group relative">
              <button
                type="button"
                title="Global filter help"
                aria-label="Global filter help"
                className="size-8 rounded-md border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground grid place-items-center"
              >
                <CircleHelp className="size-4" />
              </button>
              <div className="pointer-events-none absolute right-0 top-10 z-40 w-[min(360px,calc(100vw-2rem))] origin-top-right scale-95 rounded-md border border-border bg-popover p-3 text-popover-foreground opacity-0 shadow-lg transition group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100 group-focus-within:opacity-100">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Global filter
                </div>
                <div className="mt-1 text-sm font-semibold">{globalFilterHelp.title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {globalFilterHelp.description}
                </p>
                <div className="mt-3 space-y-2 border-t border-border pt-2 text-xs leading-5">
                  {globalFilterHelp.options.map((option) => (
                    <div key={option.label}>
                      <div className="font-medium">{option.label}</div>
                      <div className="text-muted-foreground">{option.description}</div>
                    </div>
                  ))}
                </div>
              </div>
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
    </header>
  );
}

function getGlobalFilterHelp(selectedYear: string | undefined, currentFinancialYear: string) {
  const normalizedSelected = normalizeFinancialYearLabel(selectedYear) || currentFinancialYear;
  const currentFyLabel = displayFinancialYearLabel(currentFinancialYear);
  const currentFyRange = getFinancialYearDateRangeLabel(currentFinancialYear);
  const selectedFyLabel = displayFinancialYearLabel(normalizedSelected);
  const title =
    normalizedSelected === ALL_ACTIVE_FILES_YEAR
      ? "All active files"
      : normalizedSelected === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
        ? "Active + current FY closed"
        : `FY ${selectedFyLabel}`;
  const description =
    normalizedSelected === ALL_ACTIVE_FILES_YEAR
      ? "Shows files that are not closed and not cancelled, across all financial years."
      : normalizedSelected === ACTIVE_PLUS_CURRENT_FY_CLOSED_YEAR
        ? `Shows all active files, plus files closed during current FY ${currentFyLabel}${currentFyRange ? ` (${currentFyRange})` : ""}. Cancelled files remain excluded.`
        : `Shows files created in FY ${selectedFyLabel}, and files explicitly carried as active in FY ${selectedFyLabel}.`;

  return {
    title,
    description,
    options: [
      {
        label: "Specific FY",
        description:
          "Includes files whose file year matches that FY, plus files marked active for that FY.",
      },
      {
        label: "All active files",
        description: "Includes open/live files from all years. Closed and cancelled files are excluded.",
      },
      {
        label: "Active + current FY closed",
        description: `Includes all active files, plus files closed in current FY ${currentFyLabel}${currentFyRange ? ` (${currentFyRange})` : ""}.`,
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
