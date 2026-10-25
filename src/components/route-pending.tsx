export function RoutePending() {
  return (
    <main className="grid min-h-[40vh] place-items-center bg-background px-4">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 text-sm text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
        Loading page...
      </div>
    </main>
  );
}
