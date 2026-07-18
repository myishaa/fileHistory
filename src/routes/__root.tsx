import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import appCss from "../styles.css?url";
import { TopBar } from "@/components/top-bar";
import { store, useActiveUser, useDivisions, useSettings, useStoreStatus } from "@/lib/files-store";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FileHistory — Records Management" },
      { name: "description", content: "Modern file history records management system" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "FileHistory — Records Management" },
      { property: "og:description", content: "Modern file history records management system" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settings = useSettings();
  const activeUser = useActiveUser();
  const storeStatus = useStoreStatus();
  const [hydrated, setHydrated] = useState(false);
  const themeClass = settings.theme === "dark" ? "dark" : "";
  const tintClass = `theme-tint-${settings.themeTint}`;
  const isPublicLivePage = pathname === "/mmg-live";
  const isOpeningSession =
    hydrated && !isPublicLivePage && !activeUser && !storeStatus.loaded && storeStatus.loading;

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className={`${themeClass} ${tintClass} min-h-screen w-full bg-background text-foreground`}
      >
        {isPublicLivePage ? (
          <Outlet />
        ) : isOpeningSession ? (
          <main className="grid min-h-screen place-items-center bg-background px-4">
            <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-[var(--shadow-card)]">
              Opening software...
            </div>
          </main>
        ) : activeUser ? (
          <>
            <TopBar />
            <main className="p-6 lg:p-8">
              <Outlet />
            </main>
          </>
        ) : (
          <LoginScreen />
        )}
      </div>
    </QueryClientProvider>
  );
}

function LoginScreen() {
  const navigate = useNavigate();
  const divisions = useDivisions();
  const [mode, setMode] = useState<"staff" | "viewer">("staff");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [ipAddress, setIpAddress] = useState("checking...");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    let cancelled = false;

    fetch(`${apiBaseUrl}/api/health/ip`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load IP address.");
        return (await response.json()) as { ip?: string };
      })
      .then((body) => {
        if (!cancelled) setIpAddress(body.ip || "Unknown");
      })
      .catch(() => {
        if (!cancelled) setIpAddress("Unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      if (mode === "viewer") {
        if (!divisionId) throw new Error("Select a division.");
        await store.viewerLogin(divisionId, password);
      } else {
        await store.login(username, password);
      }
      await navigate({
        to: "/search",
        search: { dashboardFilter: undefined, division: undefined },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-card)]"
      >
        <div className="mb-5">
          <h1 className="text-lg font-semibold">MMG (BU), Advanced Systems Laboratory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your IP address is {ipAddress}</p>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-border bg-secondary/30 p-1">
          <button
            type="button"
            onClick={() => setMode("staff")}
            className={
              "h-8 rounded text-sm font-medium " +
              (mode === "staff" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
            }
          >
            MMG
          </button>
          <button
            type="button"
            onClick={() => setMode("viewer")}
            className={
              "h-8 rounded text-sm font-medium " +
              (mode === "viewer" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
            }
          >
            Division
          </button>
        </div>
        <div className="space-y-3">
          {mode === "staff" ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Division</span>
              <select
                value={divisionId}
                onChange={(event) => setDivisionId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">Select division</option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </div>
      </form>
    </main>
  );
}
