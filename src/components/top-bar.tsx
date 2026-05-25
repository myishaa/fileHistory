import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { store, useSettings } from "@/lib/files-store";

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/add": "Add File",
  "/search": "Search Files",
  "/reports": "Reports",
  "/settings": "Settings",
};

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settings = useSettings();
  const title = titles[pathname] ?? "Dashboard";
  const isDark = settings.theme === "dark";

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
      <div className="min-h-14 px-4 lg:px-6 py-2.5 flex flex-wrap items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5 mr-2">
          <div className="size-8 rounded-md border border-border bg-secondary grid place-items-center">
            <FolderOpen className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">FileHistory</div>
            <div className="text-[11px] text-muted-foreground">Records management</div>
          </div>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
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
          <div className="hidden xl:block text-right">
            <h1 className="text-sm font-semibold">{title}</h1>
            <p className="text-[11px] text-muted-foreground">File history management system</p>
          </div>
          <button className="relative size-8 rounded-md border border-border bg-card hover:bg-accent grid place-items-center">
            <Bell className="size-4" />
            <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
          </button>
          <button
            type="button"
            onClick={() => store.updateSettings({ theme: isDark ? "light" : "dark" })}
            title={isDark ? "Switch to white theme" : "Switch to dark theme"}
            aria-label={isDark ? "Switch to white theme" : "Switch to dark theme"}
            className="size-8 rounded-md border border-border bg-card hover:bg-accent grid place-items-center"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Link
            to="/add"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="size-4" />
            New File
          </Link>
        </div>
      </div>
    </header>
  );
}
