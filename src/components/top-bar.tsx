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
import { store, useActiveUser, useMessages, useSettings } from "@/lib/files-store";
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
  const activeUser = useActiveUser();
  const [anomalyWarningCount, setAnomalyWarningCount] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const isDark = settings.theme === "dark";
  const canManageAdminSettings = activeUser?.role === "admin";
  const canUpdateAppearance = Boolean(activeUser);
  const canSelectYear = Boolean(activeUser);
  const canViewUserSettings = Boolean(activeUser);
  const canAddFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const visibleNav = nav.filter((item) => {
    if (item.to === "/settings") return canViewUserSettings;
    if (item.to === "/add" || item.to === "/quick-entry") return canAddFiles;
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
  const bellCount = messageWarningCount + anomalyWarningCount;
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
