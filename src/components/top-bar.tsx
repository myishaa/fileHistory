import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  FilePlus2,
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
import { useMemo } from "react";
import { store, useActiveUser, useMessages, useSettings } from "@/lib/files-store";
import { ALL_ACTIVE_FILES_YEAR, displayFinancialYearLabel } from "@/lib/year-filter";

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
  const navigate = useNavigate();
  const settings = useSettings();
  const messages = useMessages();
  const activeUser = useActiveUser();
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
  const bellCount = isViewer
    ? pendingMessages.length + viewerUnreadResolved.length
    : pendingMessages.length;
  const yearOptions = Array.from(
    new Set(
      [
        settings.financialYear,
        settings.selectedYear,
        ...settings.financialYears,
      ]
        .map((year) => year?.trim())
        .filter((year): year is string => Boolean(year) && year !== ALL_ACTIVE_FILES_YEAR),
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
              onClick={() =>
                navigate({
                  to: "/messages",
                  search: {
                    view: undefined,
                    page: undefined,
                    division: undefined,
                    section: undefined,
                  },
                })
              }
              title="Messages"
              aria-label="Messages"
              className="relative size-8 rounded-md border border-border bg-card hover:bg-accent grid place-items-center"
            >
              <Bell className="size-4" />
              {bellCount ? (
                <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                  {bellCount}
                </span>
              ) : null}
            </button>
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
