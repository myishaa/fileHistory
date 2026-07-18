import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FileText } from "lucide-react";

export const Route = createFileRoute("/help")({
  component: HelpPage,
});

function HelpPage() {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Help</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Software manual with page-wise logic, screenshots, precautions, and counter/clicker
            rules.
          </p>
        </div>
        <a
          href="/help/SOFTWARE_MANUAL.pdf"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
        >
          <FileText className="size-4" />
          Open PDF
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
        <iframe
          title="Software manual"
          src="/help/index.html"
          className="h-[calc(100vh-11rem)] min-h-[640px] w-full bg-white"
        />
      </div>
    </section>
  );
}
