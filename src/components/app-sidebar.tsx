import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  Search,
  BarChart3,
  Settings,
  FolderOpen,
  QrCode,
  ScanLine,
  Upload,
  Bell,
  CircleUser,
} from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/add", label: "Add File", icon: FilePlus2 },
  { to: "/search", label: "Search Files", icon: Search },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const futureTools = [
  { label: "Barcode Scan", icon: ScanLine },
  { label: "QR Integration", icon: QrCode },
  { label: "File Upload", icon: Upload },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
        <div className="size-9 rounded-lg bg-sidebar-primary grid place-items-center">
          <FolderOpen className="size-5 text-sidebar-primary-foreground" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">FileHistory</div>
          <div className="text-[11px] text-sidebar-foreground/60">Records Management</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 px-2 mb-2">
          Main
        </div>
        <ul className="space-y-1">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors " +
                    (active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")
                  }
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 px-2 mt-7 mb-2">
          Coming soon
        </div>
        <ul className="space-y-1">
          {futureTools.map((t) => {
            const Icon = t.icon;
            return (
              <li
                key={t.label}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-sidebar-foreground/55 cursor-not-allowed"
              >
                <span className="flex items-center gap-3">
                  <Icon className="size-4" />
                  {t.label}
                </span>
                <span className="text-[9px] uppercase tracking-wider rounded bg-sidebar-accent px-1.5 py-0.5">
                  Soon
                </span>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border p-3 flex items-center gap-3">
        <div className="size-9 rounded-full bg-sidebar-accent grid place-items-center">
          <CircleUser className="size-5" />
        </div>
        <div className="text-xs leading-tight flex-1 min-w-0">
          <div className="text-white font-medium truncate">Admin User</div>
          <div className="text-sidebar-foreground/60 truncate">admin@office.gov</div>
        </div>
        <Bell className="size-4 text-sidebar-foreground/60" />
      </div>
    </aside>
  );
}
