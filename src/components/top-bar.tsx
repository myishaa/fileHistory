import { useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  Building2,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/add": "Add File",
  "/search": "Search Files",
  "/divisions": "Divisions",
  "/reports": "Reports",
  "/settings": "Settings",
};

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/divisions", label: "Divisions", icon: Building2 },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = titles[pathname] ?? "Dashboard";

  return (
    <header className="border-b border-border bg-card sticky top-0 z-10">
      <div className="min-h-16 px-4 lg:px-6 py-3 flex flex-wrap items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5 mr-2">
          <div className="size-9 rounded-lg bg-primary grid place-items-center">
            <FolderOpen className="size-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">OfficeFiles</div>
            <div className="text-[11px] text-muted-foreground">Records Management</div>
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
                  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground shadow-sm"
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
            <p className="text-[11px] text-muted-foreground">Office records management system</p>
          </div>
          <Link
            to="/search"
            className="hidden 2xl:flex items-center gap-2 w-64 h-9 px-3 rounded-md bg-secondary text-muted-foreground text-sm hover:bg-accent transition-colors"
          >
            <Search className="size-4" />
            <span>Quick search files...</span>
          </Link>
          <button className="relative size-9 rounded-md border border-border bg-card hover:bg-accent grid place-items-center">
            <Bell className="size-4" />
            <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
          </button>
          <Link
            to="/add"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="size-4" />
            New File
          </Link>
        </div>
      </div>
    </header>
  );
}
